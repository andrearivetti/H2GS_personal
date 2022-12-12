/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */

define(['N/search', 'N/currency'], function(search, N_currency) {

    const maxNumberOfEscalation = 10;
    const unlimitedAmountForAllEscalationLevels = 100000000000;
    const approvalCurrency = 1; // SEK since there is no currency in the approval limit field we are assuming we will configure all employees approval limits in SEK

    // This workflow action it's executed in the workflow stages:
    // - Determine Cost Center Approver of the workflow [H2GS][AF] Purchase Requisition Approval
    // the action it's executed before submitting the record, both in create / edit event

    var GLB_escalationLog = '';
    var EmployeeIdToNameMap = {};
    var CCRuleIdToNameMap = {};
    var firstSessionLog = true;

    function _handleWFAction(scriptContext) {
        log.audit({
            title: '_handleWFAction',
            details: 'start'
        });

        const oldRecord = scriptContext.oldRecord;
        const newRecord = scriptContext.newRecord;
        const workflowId = scriptContext.workflowId;
        const eventType = scriptContext.type;
        const recordId = newRecord.id;
        const recordType = newRecord.getValue('type');
        const approvalType = newRecord.getValue('custbody_h2gs_af_approval_type');

        log.audit({
            title: '_handleWFAction core',
            details: 'workflowId: ' + workflowId + ' eventType: ' + eventType + ' recordId: ' + recordId + ' recordType: ' + recordType
        });

        // Generating a map ID-> name for employee record so that logs will be OK from a user UI pov
        EmployeeIdToNameMap = _getRecordIdToNameMap('employee', 'entityid')
        // Generating a map ID-> name for cost center record so that logs will be OK from a user UI pov
        CCRuleIdToNameMap = _getRecordIdToNameMap('customrecord_h2gf_af_approval_rule', 'name')

        const AllLevelsAllApproving = _allLevelsApproving(recordType,approvalType, newRecord);

        // Determine next approver
        var nextApproverId = null;
        var wasTheLastApproval = false;

        // determine purchaser
        const purchaser = newRecord.getValue('custbody_h2gs_af_purchaser');
        // determine last approver, if empty then this is the first approval else it means that we need to escalate
        const currentApprover = newRecord.getValue('custbody_h2gs_af_current_approver');
        // determine approval cost center
        const approvalCostCenterRuleId = newRecord.getValue('custbody_h2gs_af_approvalrule');
        // determine the approval amount in SEK for the current transaction

        log.audit({
            title: '_handleWFAction core',
            details: 'AllLevelsAllApproving: ' + AllLevelsAllApproving + ' purchaser: ' + purchaser + ' currentApprover: ' + currentApprover + ' approvalCostCenterRuleId: ' + approvalCostCenterRuleId
        });

        var recordDataBlockingIssue = _determineRecordDataBlockingIssue(approvalCostCenterRuleId,recordType, purchaser, newRecord);

        log.audit({
            title: '_handleWFAction core',
            details: 'recordDataBlockingIssue: ' + recordDataBlockingIssue
        });

        var blockingIssueDeterminingApprover = false;

        var nextApprover = null;
        var nextWillBeTheLastApproval = false;
        var canApproveAmountTo = 0;

        var approvalAmountSEK = _determineApprovalAmountInSEK(newRecord,recordType);
        newRecord.setValue('custbody_h2gs_af_sek_amount_appr', approvalAmountSEK);

        if (!recordDataBlockingIssue){
            // DETERMINE IF ITS THE FIRST APPROVAL

            if (!currentApprover){
                _appendToLog(newRecord,'Determining first approver for rule ' + CCRuleIdToNameMap[approvalCostCenterRuleId]);

                // YES, ITS THE FIRST APPROVAL
                var costCenterManagerInfo = _getCostCenterManager(approvalCostCenterRuleId);

                log.audit({
                    title: '_handleWFAction core',
                    details: 'costCenterManagerInfo: ' + JSON.stringify(costCenterManagerInfo)
                });

                blockingIssueDeterminingApprover = _handleCostCenterApproverResult(costCenterManagerInfo, newRecord, approvalCostCenterRuleId);

                if (!blockingIssueDeterminingApprover){
                    // if its a purchase requisition, the purchaser cannot be the cost center manager approver
                    // if its a purchase order, only if it's a free purchase order that we ensure that the creator (purchaser) its not the one approving
                    if ((recordType == 'purchreq') || ((recordType == 'purchord') && (approvalType == '3'))){
                        if (parseInt(purchaser,10) == parseInt(costCenterManagerInfo.nextApprover,10)){
                            // THE DETERMINED COST CENTER MANAGER IS THE PURCHASER, ESCALATING

                            if (recordType == 'purchreq'){
                                _appendToLog(newRecord,'cost center manager is the requisition purchaser determining his purchase approver');
                            } else {
                                _appendToLog(newRecord,'cost center manager is the purchase order purchaser (free purchase order) determining his purchase approver');
                            }


                            var nextApproverInfo = _determineCurrentApproverNextApprover(newRecord, costCenterManagerInfo.nextApprover)

                            blockingIssueDeterminingApprover = _handleNextApproverResult(nextApproverInfo, newRecord, costCenterManagerInfo.nextApprover);

                            if (!blockingIssueDeterminingApprover){
                                nextApprover = nextApproverInfo.nextApprover;
                                canApproveAmountTo = nextApproverInfo.canApproveAmountTo;

                                _appendToLog(newRecord,'Determined ' + EmployeeIdToNameMap[nextApprover] + ' as next approver for ' + EmployeeIdToNameMap[purchaser] + ' can approve amount up to: ' + canApproveAmountTo);
                            }

                        } else {
                            // THE DETERMINED COST CENTER MANAGER IS NOT THE PURCHASER, NEXT APPROVER DETERMINED
                            nextApprover = costCenterManagerInfo.nextApprover;
                            canApproveAmountTo = costCenterManagerInfo.canApproveAmountTo

                            _appendToLog(newRecord,'Determined ' + EmployeeIdToNameMap[nextApprover] + ' as cost center manager for the rule ' + CCRuleIdToNameMap[approvalCostCenterRuleId] + ' can approve amount up to: ' + canApproveAmountTo);
                        }
                    } else {
                        // ITS A PURCHASER ORDER, WE DONT CARE ABOUT THE PURCHASER
                        nextApprover = costCenterManagerInfo.nextApprover;
                        canApproveAmountTo = costCenterManagerInfo.canApproveAmountTo

                        _appendToLog(newRecord,'Determined ' + EmployeeIdToNameMap[nextApprover] + ' as cost center manager for the rule ' + CCRuleIdToNameMap[approvalCostCenterRuleId] + ' can approve amount up to: ' + canApproveAmountTo);
                    }
                }
            } else {
                _appendToLog(newRecord,'Determining next approver for employee  ' + EmployeeIdToNameMap[currentApprover]);
                // ESCALATION, FOR THIS IS REALLY IMPORTANT TO CONSIDER AllLevelsAllApproving
                // IF EVERYONE WILL APPROVE UNTILL WE FOUND THE APPROVER WITH THE RIGHT APPROVAL AMOUNT
                // THEN WE ARE JUST LOOKING FOR THE NEXT APPROVER (AllLevelsAllApproving = true)
                if (AllLevelsAllApproving){

                    var nextApproverInfo = _determineCurrentApproverNextApprover(newRecord, currentApprover)

                    blockingIssueDeterminingApprover = _handleNextApproverResult(nextApproverInfo, newRecord, currentApprover);

                    if (!blockingIssueDeterminingApprover){
                        nextApprover = nextApproverInfo.nextApprover;
                        canApproveAmountTo = nextApproverInfo.canApproveAmountTo;

                        _appendToLog(newRecord,'Determined ' + EmployeeIdToNameMap[nextApprover] + ' as next approver for ' + EmployeeIdToNameMap[currentApprover] + ' can approve amount up to: ' + canApproveAmountTo);
                    }
                } else {
                    // ELSE WE ESCALATE AND WE ONLY SET THE APPROVER WITH THE RIGHT APPROVAL AMOUNT
                    var numberOfEscalation = 0;
                    var blockingIssueDeterminingLastApprover = false;
                    var currentNextApproverInfo = {};
                    var approvalAmountIsEnoughToApprove = false;
                    currentNextApproverInfo.nextApprover = currentApprover;

                    while ((numberOfEscalation < maxNumberOfEscalation) && (!blockingIssueDeterminingLastApprover) && (!approvalAmountIsEnoughToApprove)){

                        currentNextApproverInfo = _determineCurrentApproverFinalApprover(newRecord, currentNextApproverInfo);

                        blockingIssueDeterminingLastApprover = _handleNextApproverResult(currentNextApproverInfo, newRecord, currentNextApproverInfo.nextApprover);

                        if (!blockingIssueDeterminingLastApprover){
                            nextApprover = currentNextApproverInfo.nextApprover;
                            canApproveAmountTo = currentNextApproverInfo.canApproveAmountTo;

                            if (approvalAmountSEK > canApproveAmountTo) {
                                approvalAmountIsEnoughToApprove = false;
                                _appendToLog(newRecord,'Determined ' + EmployeeIdToNameMap[nextApprover] + ' as next approver can approve amount up to: ' + canApproveAmountTo + ' to be approved amount: ' + approvalAmountSEK + ' ESCALATING ');
                            } else {
                                approvalAmountIsEnoughToApprove = true;
                                _appendToLog(newRecord,'Determined ' + EmployeeIdToNameMap[nextApprover] + ' as next approver can approve amount up to: ' + canApproveAmountTo + ' to be approved amount: ' + approvalAmountSEK + ' DONE ');
                            }
                        }
                    }
                }
            }
        }

        if (recordDataBlockingIssue || blockingIssueDeterminingApprover || blockingIssueDeterminingLastApprover){
            newRecord.setValue('custbody_h2gs_af_issue_conf', true);
        } else {
            if (nextApprover){

                nextWillBeTheLastApproval = _nextWillBeTheLastApproval(newRecord,recordType,canApproveAmountTo, approvalAmountSEK);

                log.audit({
                    title: '_handleWFAction core',
                    details: 'setting next approver as : ' + nextApprover + ' next will be last approval: ' + nextWillBeTheLastApproval
                });

                newRecord.setValue('custbody_h2gs_af_issue_conf', false);
                newRecord.setValue('custbody_h2gs_af_current_approver', nextApprover)
                newRecord.setValue('custbody_h2gs_af_all_levels_approved', nextWillBeTheLastApproval)
            } else {

                log.error({
                    title: '_handleWFAction core',
                    details: 'cant set next approver as : ' + nextApprover + ' even if there are not configuration issues'
                });

                newRecord.setValue('custbody_h2gs_af_issue_conf', true);
            }
        }

        if (1==2){
            throw 'DEBUG HERE'


            var nextApproverRetObj = _determineCostCenterNextApprover(newRecord, AllLevelsAllApproving, recordType);

            if (nextApproverRetObj){
                nextApproverId = nextApproverRetObj.nextApprover;
                wasTheLastApproval = nextApproverRetObj.wasTheLastApproval;
            }

            log.audit({
                title: '_handleWFAction core',
                details: 'nextApproverId: ' + nextApproverId
            });

            // handling result
            if (nextApproverId == 'NOT FOUND' || nextApproverId == 'NOT CONFIGURED'){
                // next approver cannot be determined
                GLB_escalationLog += '\nFAILURE'
                newRecord.setValue('custbody_h2gs_af_issue_conf', true)
            } else {
                if(nextApproverId){
                    // next approver has been determined, setting it into the record
                    newRecord.setValue('custbody_h2gs_af_issue_conf', false)
                    newRecord.setValue('custbody_h2gs_af_current_approver', nextApproverId)
                    newRecord.setValue('custbody_h2gs_af_all_levels_approved', wasTheLastApproval)
                    GLB_escalationLog += '\nSUCCESS, setting next approver ' + nextApproverId + ' name ' + _getEmployeeNameFromId(nextApproverId) + ' , next will be last approval ' + wasTheLastApproval
                    log.audit({
                        title: '_handleWFAction',
                        details: 'set next approver as: ' + nextApproverId
                    });
                }
            }

            // handling log. The log work in append mode (maybe it will never be needed but at least we are never loosing previous log)
            var currentLog = newRecord.getValue('custbody_h2gs_af_approval_conf_err');
            var newLog = currentLog + '\n\n' + new Date() + GLB_escalationLog;
            newRecord.setValue('custbody_h2gs_af_approval_conf_err', newLog)

            log.audit({
                title: '_handleWFAction',
                details: 'end, return next approver: ' + nextApproverId
            });

            // returning the value to the workflow. At this moment its not needed since the set field values it's inside this fucntion since are multiple
            // if in the future we will need to handle the return value in the workflow the function it's already hadnling it
            return nextApproverId;
        }

    };

    function _determineApprovalAmountInSEK(newRecord,recordType){
        var approvalAmountS = null;

        // IF ITS A PURCHASE REQUISITION
        if (recordType == 'purchreq'){
            // WE GET THE TOTAL FROM this field estimatedtotal
            approvalAmountS = newRecord.getValue('estimatedtotal')

            log.audit({
                title: '_determineApprovalAmountInSEK',
                details: 'Got amount from estimated total for the type ' + recordType
            });

        } else { // ELSE ITS A PURCHASE ORDER SO GET THE TOTAL FROM total
            approvalAmountS = newRecord.getValue('total')

            log.audit({
                title: '_determineApprovalAmountInSEK',
                details: 'Got amount from total for the type ' + recordType
            });
        }

        var approvalAmount = Math.round(parseFloat(approvalAmountS)*100)/100
        var approvalAmountSEK = approvalAmount;

        var transactionCurrency = newRecord.getValue('currency');
        var tranDate = newRecord.getValue('trandate');
        var exchangeRate = 1;

        if (parseInt(transactionCurrency,10) != parseInt(approvalCurrency,10)){

            log.audit({
                title: '_determineApprovalAmountInSEK',
                details: 'calculating exchange rate to get SEK approval amount from transactionCurrency: ' + transactionCurrency + ' approvalCurrency: ' + approvalCurrency+ ' tranDate: ' + tranDate
            });

            exchangeRate = N_currency.exchangeRate({
                source: transactionCurrency,
                target: approvalCurrency,
                date: tranDate
            });

            log.audit({
                title: '_determineApprovalAmountInSEK',
                details: 'GOT: ' + exchangeRate
            });

            if(!exchangeRate){
                exchangeRate = 1;
                log.audit({
                    title: '_determineApprovalAmountInSEK',
                    details: 'Did not get any value, overrided to 1: ' + exchangeRate
                });
            }

            approvalAmountSEK = approvalAmount*exchangeRate;
        } else {
            log.audit({
                title: '_determineApprovalAmountInSEK',
                details: 'transaction currency its sek (1): ' + transactionCurrency + ' approvalCurrency: ' + approvalCurrency+ ' exch rate not needed'
            });
        }

        approvalAmountSEK = Math.round(parseFloat(approvalAmountSEK)*100)/100

        return approvalAmountSEK
    };

    function _determineRecordDataBlockingIssue(approvalCostCenterRuleId,recordType, purchaser, newRecord){
        var dataBlockingIssue = false;
        if (!approvalCostCenterRuleId){

            log.error({
                title: '_determineRecordDataBlockingIssue',
                details: 'Approval rule not determined, cant determine first approver'
            });

            _appendToLog(newRecord,'Approval rule not determined, cant determine first approver');
            dataBlockingIssue = true;
        }

        if (recordType == 'purchreq'){
            if (!purchaser){

                log.error({
                    title: '_determineRecordDataBlockingIssue',
                    details: 'Purchase requisition without purchaser, cant determine first approver'
                });

                _appendToLog(newRecord,'Purchase requisition without purchaser, cant determine first approver');
                dataBlockingIssue = true;
            }
        }

        return dataBlockingIssue;
    };

    function _handleCostCenterApproverResult(costCenterManagerInfo, newRecord, approvalCostCenterRuleId){

        var blockingIssueDeterminingApprover = false;

        if ((costCenterManagerInfo.nextApprover == 'NOT CONFIGURED')){
            blockingIssueDeterminingApprover = true;
            _appendToLog(newRecord,'Cost center manager not configured properly for rule ' + CCRuleIdToNameMap[approvalCostCenterRuleId]);
        }
        if ((costCenterManagerInfo.nextApprover == 'NOT FOUND')){
            blockingIssueDeterminingApprover = true;
            _appendToLog(newRecord,'Cost center manager not found ' + CCRuleIdToNameMap[approvalCostCenterRuleId]);
        }

        return blockingIssueDeterminingApprover;
    }

    function _handleNextApproverResult(costCenterManagerInfo, newRecord, currentApprover){

        var blockingIssueDeterminingApprover = false;

        if ((costCenterManagerInfo.nextApprover == 'NOT CONFIGURED')){
            blockingIssueDeterminingApprover = true;
            _appendToLog(newRecord,'Next approver not configured properly');
        }
        if ((costCenterManagerInfo.nextApprover == 'NOT FOUND')){
            blockingIssueDeterminingApprover = true;
            _appendToLog(newRecord,'Next approver not found');
        }

        return blockingIssueDeterminingApprover;
    }

    function _nextWillBeTheLastApproval(newRecord, recordType, canApproveAmount, approvalAmountSEK){

        if (approvalAmountSEK > canApproveAmount){

            log.audit({
                title: '_nextWillBeTheLastApproval',
                details: 'returning false, approvalAmountSEK: ' + approvalAmountSEK + ' canApproveAmount: ' + canApproveAmount
            });

            return false
        } else {

            log.audit({
                title: '_nextWillBeTheLastApproval',
                details: 'returning true, approvalAmountSEK: ' + approvalAmountSEK + ' canApproveAmount: ' + canApproveAmount
            });

            return true
        }
    };

    function _determineCurrentApproverFinalApprover(newRecord, currentApproverInfo){
        log.audit({
            title: '_determineCurrentApproverFinalApprover',
            details: 'start: ' + currentApproverInfo.nextApprover
        });

        var nextApproverInfo = {
            nextApprover: 'NOT FOUND',
            canApproveAmountTo: 0
        };

        var employeeSearchObj = search.create({
            type: "employee",
            filters:
                [
                    ["internalid","anyof",currentApproverInfo.nextApprover]
                ],
            columns:
                [
                    search.createColumn({name: "purchaseorderapprover", label: "Purchase Approver"}),
                ]
        });
        var searchResultCount = employeeSearchObj.runPaged().count;

        log.debug({
            title: '_determineCurrentApproverFinalApprover',
            details: 'employeeSearchObj result count: ' + searchResultCount
        });

        employeeSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results
            nextApproverInfo.nextApprover = 'NOT CONFIGURED'

            var nextApproverFromSearch = result.getValue({
                name: 'purchaseorderapprover'
            });

            if (nextApproverFromSearch){
                nextApproverInfo.nextApprover =nextApproverFromSearch;
            }

            nextApproverInfo.canApproveAmountTo = 0;

            if (nextApproverInfo.nextApprover && nextApproverInfo.nextApprover != 'NOT CONFIGURED'){
                var approvalLimit = _getEmployeeApprovalLimit(nextApproverInfo.nextApprover)

                log.debug({
                    title: '_determineCurrentApproverFinalApprover',
                    details: 'approval limit from search: ' + approvalLimit + ' next approver: ' + nextApproverInfo.nextApprover
                });

                if (approvalLimit){
                    nextApproverInfo.canApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
                } else {
                    nextApproverInfo.canApproveAmountTo = 0;
                }
            }

            return true;
        });

        return nextApproverInfo;
    }

    function _determineCurrentApproverNextApprover(newRecord, currentApprover){
        log.audit({
            title: '_determineCurrentApproverNextApprover',
            details: 'start: ' + currentApprover
        });

        var nextApproverInfo = {
            nextApprover: 'NOT FOUND',
            canApproveAmountTo: 0
        };

        var employeeSearchObj = search.create({
            type: "employee",
            filters:
                [
                    ["internalid","anyof",currentApprover]
                ],
            columns:
                [
                    search.createColumn({name: "purchaseorderapprover", label: "Purchase Approver"}),
                ]
        });
        var searchResultCount = employeeSearchObj.runPaged().count;

        log.debug({
            title: '_determineCurrentApproverNextApprover',
            details: 'employeeSearchObj result count: ' + searchResultCount
        });

        employeeSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results

            nextApproverInfo = {};
            nextApproverInfo.nextApprover = 'NOT CONFIGURED'

            var nextApproverFromSearch = result.getValue({
                name: 'purchaseorderapprover'
            });

            if (nextApproverFromSearch){
                nextApproverInfo.nextApprover =nextApproverFromSearch;
            }

            nextApproverInfo.canApproveAmountTo = 0;

            if (nextApproverInfo.nextApprover && nextApproverInfo.nextApprover != 'NOT CONFIGURED'){
                var approvalLimit = _getEmployeeApprovalLimit(nextApproverInfo.nextApprover)

                log.debug({
                    title: '_determineCurrentApproverNextApprover',
                    details: 'approval limit from search: ' + approvalLimit + ' next approver: ' + nextApproverInfo.nextApprover
                });

                if (approvalLimit){
                    nextApproverInfo.canApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
                } else {
                    nextApproverInfo.canApproveAmountTo = 0;
                }
            }

            return true;
        });

        return nextApproverInfo;
    };

    function _appendToLog(newRecord,newLogToAppend){
        var currentLog = newRecord.getValue('custbody_h2gs_af_approval_conf_err');
        var newLog = '';

        if (firstSessionLog){
            firstSessionLog = false;
            newLog = currentLog + '\n\n' + new Date() + newLogToAppend;
        } else {
            newLog = currentLog + '\n' + newLogToAppend;
        }

        newRecord.setValue('custbody_h2gs_af_approval_conf_err', newLog)
    }

    function _allLevelsApproving(recordType,approvalType, newRecord){
        var allLevelsWillApprove = true;
        // before determining next approver we need to understan if all levels will approve or only the one with the biggest amount
        // in order to do so we need to
        // in the purchase requisition, all levels are always approving
        if (recordType == 'purchreq'){
            allLevelsWillApprove = true;

            log.audit({
                title: '_allLevelsApproving',
                details: 'its a purchase requisition, everyone will approve'
            });

        } else {
            // if its a purchase order, then if
            // otherwise all levels will approve
            if (recordType == 'purchord'){
                // its generated from a purchase requisition only the last level will approve
                // to understand the origin of the PO then we check the [H2G][AF] APPROVAL TYPE field value

                log.audit({
                    title: '_allLevelsApproving',
                    details: 'its a purchase order, checking approval type: ' + approvalType
                });

                if ((approvalType == '1') || (approvalType == '2') || (approvalType == '5')){ // 1: PurchaseRequisitionFlow, 5: PurchaseRequisitionAndContractFlow

                    log.audit({
                        title: '_allLevelsApproving',
                        details: 'its created from a purchase requisition or contract, only the last level will have to approve: ' + approvalType
                    });

                    allLevelsWillApprove = false;  // useless since its declared true. Right now I prefer to keep the default as TRUE instead of null since I will add explicit logs in the useless branch either way
                } else {

                    log.audit({
                        title: '_allLevelsApproving',
                        details: 'its NOT created from a purchase requisition, everyone will have to approve: ' + approvalType
                    });

                    allLevelsWillApprove = true;
                }


            }
        }

        _appendToLog(newRecord,'Record is ' + recordType + ' and approval flow type is ' + approvalType + ' all levels will approve: ' + allLevelsWillApprove);

        return allLevelsWillApprove
    }

    function _getRecordIdToNameMap(recordType, fieldToMap){
        const RecordIdToNameMap = {};

        var recordIdToNameSearchObj = search.create({
            type: recordType,
            columns:
                [
                    search.createColumn({name: "internalid"}),
                    search.createColumn({name: fieldToMap}),
                ]
        });

        var recordIdToNameSearchObjCount = recordIdToNameSearchObj.runPaged().count;

        log.debug({
            title: '_getRecordIdToNameMap',
            details: 'recordIdToNameSearchObjCount result count: ' + recordIdToNameSearchObjCount
        });

        var recordId = null;
        var recordName = null;
        recordIdToNameSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results

            recordId = result.getValue({
                name: 'internalid'
            });

            recordName = result.getValue({
                name: fieldToMap
            });

            if (recordId){
                if (typeof RecordIdToNameMap[recordId] == 'undefined'){
                    RecordIdToNameMap[recordId] = recordName;
                }
            }

            return true;
        });

        log.debug({
            title: '_getRecordIdToNameMap',
            details: 'got this map for record: ' + recordType + ' value: ' + JSON.stringify(RecordIdToNameMap)
        });

        return RecordIdToNameMap
    };

    function _getEmployeeNameFromId(employeeId){
        log.debug({
            title: '_getEmployeeNameFromId',
            details: 'resolving name for employee id: ' + employeeId
        });

        log.debug({
            title: '_getEmployeeNameFromId',
            details: 'returning: ' + EmployeeIdToNameMap[employeeId] + ' from map ' + JSON.stringify(EmployeeIdToNameMap)
        });

        return EmployeeIdToNameMap[employeeId];
    };

    function _getCostCenterManager(approvalCostCenterRuleId){

        var departmentSearchObj = search.create({
            type: "customrecord_h2gf_af_approval_rule",
            filters:
                [
                    ["internalid","anyof",approvalCostCenterRuleId]
                ],
            columns:
                [
                    search.createColumn({
                        name: "name",
                        sort: search.Sort.ASC,
                        label: "Name"
                    }),
                    search.createColumn({
                        name: "purchaseorderapprovallimit",
                        join: "custrecordd_h2gf_af_ar_approver",
                        label: "Purchase Approval Limit"
                    }),
                    search.createColumn({
                        name: "custrecordd_h2gf_af_ar_approver",
                    })
                ]
        });
        var searchResultCount = departmentSearchObj.runPaged().count;

        log.debug("departmentSearchObj result count",searchResultCount);

        var costCenterManagerInfo = {};
        costCenterManagerInfo.nextApprover = 'NOT FOUND'
        costCenterManagerInfo.canApproveAmountTo = 0;

        departmentSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results

            costCenterManagerInfo = {};
            costCenterManagerInfo.nextApprover = 'NOT CONFIGURED'
            costCenterManagerInfo.canApproveAmountTo = 0;

            var searchCostCenterApprover = result.getValue({
                name: 'custrecordd_h2gf_af_ar_approver'
            });

            if (searchCostCenterApprover){
                costCenterManagerInfo.nextApprover = searchCostCenterApprover;
            }

            var approvalLimit = result.getValue({
                name: 'purchaseorderapprovallimit',
                join: 'custrecordd_h2gf_af_ar_approver'
            });

            if (approvalLimit){
                costCenterManagerInfo.canApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
            } else {
                costCenterManagerInfo.canApproveAmountTo = 0;
            }

            return true;
        });

        return costCenterManagerInfo;
    }

    function _getEmployeeApprovalLimit(employeeId){

        log.audit({
            title: '_getEmployeeApprovalLimit',
            details: 'start: ' + employeeId
        });

        var employeeApprovalLimitSearchObj = search.create({
            type: "employee",
            filters:
                [
                    ["internalid","anyof",employeeId]
                ],
            columns:
                [
                    search.createColumn({name: "purchaseorderapprovallimit", label: "Purchase Approver"}),
                ]
        });

        var employeeApprovalLimitSearchCount = employeeApprovalLimitSearchObj.runPaged().count;

        log.debug({
            title: '_getEmployeeApprovalLimit',
            details: 'employeeApprovalLimitSearchObj result count: ' + employeeApprovalLimitSearchCount
        });

        var approvalLimit = 0;
        employeeApprovalLimitSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results

            var approvalLimitValue = result.getValue({
                name: 'purchaseorderapprovallimit'
            });

            log.debug({
                title: '_getEmployeeApprovalLimit',
                details: 'approval limit from search: ' + approvalLimitValue
            });

            if (approvalLimitValue){
                approvalLimit = Math.round(parseFloat(approvalLimitValue)*100)/100;
            }

            return true;
        });

        return approvalLimit
    }

    function _getNextApprover(currentApprover, AllLevelsAllApproving){
        // search for the purchase approver for this employee

        log.audit({
            title: '_getNextApprover',
            details: 'start: ' + currentApprover
        });

        var employeeSearchObj = search.create({
            type: "employee",
            filters:
                [
                    ["internalid","anyof",currentApprover]
                ],
            columns:
                [
                    search.createColumn({name: "purchaseorderapprover", label: "Purchase Approver"}),
                ]
        });
        var searchResultCount = employeeSearchObj.runPaged().count;

        log.debug({
            title: '_getNextApprover',
            details: 'employeeSearchObj result count: ' + searchResultCount
        });

        var nextApproverInfo = null;
        employeeSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results

            nextApproverInfo = {};
            nextApproverInfo.nextApprover = 'NOT CONFIGURED'

            var nextApproverFromSearch = result.getValue({
                name: 'purchaseorderapprover'
            });

            if (nextApproverFromSearch){
                nextApproverInfo.nextApprover =nextApproverFromSearch;
            }

            nextApproverInfo.canApproveAmountTo = 0;

            if (nextApproverInfo.nextApprover && nextApproverInfo.nextApprover != 'NOT CONFIGURED'){
                var approvalLimit = _getEmployeeApprovalLimit(nextApproverInfo.nextApprover)

                log.debug({
                    title: '_getNextApprover',
                    details: 'approval limit from search: ' + approvalLimit + ' next approver: ' + nextApproverInfo.nextApprover
                });

                if (approvalLimit){
                    nextApproverInfo.canApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
                } else {
                    nextApproverInfo.canApproveAmountTo = 0;
                }

                if (AllLevelsAllApproving){

                    log.audit({
                        title: '_getNextApprover',
                        details: 'All levels will approve, so the approval limit its set to unlimitedAmountForAllEscalationLevels'
                    });

                    nextApproverInfo.canApproveAmountTo = unlimitedAmountForAllEscalationLevels;
                }
            }

            return true;
        });

        if (nextApproverInfo){
            return nextApproverInfo;
        } else {
            return {
                nextApprover: 'NOT FOUND',
                canApproveAmountTo: 0
            };
        }
    }

    function _determineNextApprover(purchaser, approvalAmount, approvalCostCenterRuleId, approverInfo, AllLevelsAllApproving, lastapprover, numberOfEscalation){

        //  (approverInfo.canApproveAmountTo < approvalAmount)

        log.audit({
            title: '_determineNextApprover',
            details: 'current lastapprover: ' + lastapprover
        });

        var employeeToConsiderAsLast = null;
        if (AllLevelsAllApproving){

            if (numberOfEscalation == 0){
                log.audit({
                    title: '_determineNextApprover',
                    details: 'current lastapprover (no escalations): ' + lastapprover
                });

                employeeToConsiderAsLast = lastapprover;
            } else {
                log.audit({
                    title: '_determineNextApprover',
                    details: 'current lastapprover (escalation): ' + approverInfo.nextApprover
                });

                employeeToConsiderAsLast = approverInfo.nextApprover;
            }

        } else {

            log.audit({
                title: '_determineNextApprover',
                details: 'last determined approver: ' + approverInfo.nextApprover
            });

            employeeToConsiderAsLast = approverInfo.nextApprover;
        }

        // approval escalation
        if (employeeToConsiderAsLast){
            log.audit({
                title: '_determineNextApprover',
                details: 'escalating approval for: ' + employeeToConsiderAsLast
            });

            GLB_escalationLog += '\nApproval Escalation, getting next approver for last approver employee id ' + lastapprover + ', name ' + _getEmployeeNameFromId(employeeToConsiderAsLast)
            var costCenterManagerInfo = _getNextApprover(employeeToConsiderAsLast, AllLevelsAllApproving);

            if (AllLevelsAllApproving){
                GLB_escalationLog += '\nGot id ' + costCenterManagerInfo.nextApprover + '  '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' as approver, can approve amount to (discarded because everyone will approve): ' + costCenterManagerInfo.canApproveAmountTo
            } else {
                GLB_escalationLog += '\nGot id ' + costCenterManagerInfo.nextApprover + '  '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' as approver, can approve amount to: ' + costCenterManagerInfo.canApproveAmountTo
            }

            log.debug({
                title: '_determineNextApprover',
                details: 'costCenterManagerInfo from _getNextApprover: ' + JSON.stringify(costCenterManagerInfo)
            });

            return costCenterManagerInfo
        } else {
            log.audit({
                title: '_determineNextApprover',
                details: 'first approval, need to determine cost center first approver for cost center rule: ' + approvalCostCenterRuleId
            });

            GLB_escalationLog += '\nFirst approval, getting cost center manager for cost center id ' + approvalCostCenterRuleId + ' name ' + CCRuleIdToNameMap[approvalCostCenterRuleId]
            var costCenterManagerInfo = _getCostCenterManager(approvalCostCenterRuleId, AllLevelsAllApproving);

            if (AllLevelsAllApproving){
                GLB_escalationLog += '\nCost Center Manager determined id ' + costCenterManagerInfo.nextApprover + ' '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' can approve amount to (discarded because everyone will approve): ' + costCenterManagerInfo.canApproveAmountTo
            } else {
                GLB_escalationLog += '\nCost Center Manager determined id ' + costCenterManagerInfo.nextApprover + ' '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' can approve amount to: ' + costCenterManagerInfo.canApproveAmountTo
            }


            log.debug({
                title: '_determineNextApprover',
                details: 'costCenterManagerInfo from _getCostCenterManager: ' + JSON.stringify(costCenterManagerInfo)
            });

            return costCenterManagerInfo
        }

    }


    function _determineCostCenterNextApprover(newRecord, AllLevelsAllApproving, recordType){
        // determine purchaser
        const purchaser = newRecord.getValue('custbody_h2gs_af_purchaser');
        // determine last approver, if empty then this is the first approval else it means that we need to escalate
        const lastapprover = newRecord.getValue('custbody_h2gs_af_current_approver');
        // determine approval cost center
        const approvalCostCenterRuleId = newRecord.getValue('custbody_h2gs_af_approvalrule');
        // determine the approval amount in SEK for the current transaction

        var approvalAmountS = null;

        // IF ITS A PURCHASE REQUISITION
        if (recordType == 'purchreq'){
            // WE GET THE TOTAL FROM this field estimatedtotal
            approvalAmountS = newRecord.getValue('estimatedtotal')

            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'Got amount from estimated total for the type ' + recordType
            });

        } else { // ELSE ITS A PURCHASE ORDER SO GET THE TOTAL FROM total
            approvalAmountS = newRecord.getValue('total')

            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'Got amount from total for the type ' + recordType
            });
        }

        var approvalAmount = Math.round(parseFloat(approvalAmountS)*100)/100
        var approvalAmountSEK = approvalAmount;

        var transactionCurrency = newRecord.getValue('currency');
        var tranDate = newRecord.getValue('trandate');
        var exchangeRate = 1;

        if (parseInt(transactionCurrency,10) != parseInt(approvalCurrency,10)){

            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'calculating exchange rate to get SEK approval amount from transactionCurrency: ' + transactionCurrency + ' approvalCurrency: ' + approvalCurrency+ ' tranDate: ' + tranDate
            });

            exchangeRate = N_currency.exchangeRate({
                source: transactionCurrency,
                target: approvalCurrency,
                date: tranDate
            });

            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'GOT: ' + exchangeRate
            });

            if(!exchangeRate){
                exchangeRate = 1;
                log.audit({
                    title: '_determineCostCenterNextApprover',
                    details: 'Did not get any value, overrided to 1: ' + exchangeRate
                });
            }

            approvalAmountSEK = approvalAmount*exchangeRate;
        } else {
            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'transaction currency its sek (1): ' + transactionCurrency + ' approvalCurrency: ' + approvalCurrency+ ' exch rate not needed'
            });
        }

        newRecord.setValue('custbody_h2gs_af_sek_amount_appr', approvalAmountSEK);

        // if different than sek then convert to sek and save in custbody_h2gs_af_sek_amount_appr
        // use custbody_h2gs_af_sek_amount_appr to read the value of approvalAmountS instead of estimated total

        log.audit({
            title: '_determineCostCenterNextApprover',
            details: 'purchaser: ' + purchaser + ' lastapprover: ' + lastapprover+ ' approvalCostCenterRuleId: ' + approvalCostCenterRuleId+ ' approvalAmount: ' + approvalAmount+ ' approvalAmountSEK: ' + approvalAmountSEK
        });

        approvalAmount = approvalAmountSEK;

        var nextApprover = null;

        if (approvalCostCenterRuleId && approvalAmount && purchaser){

            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'determining next approver'
            });

            var approverInfo = {};
            approverInfo.canApproveAmountTo = 0;
            approverInfo.nextApprover = null;

            var numberOfEscalation = 0;
            while (
                    (
                        (!approverInfo.nextApprover) || (parseInt(lastapprover,10) == parseInt(approverInfo.nextApprover,10))  || (parseInt(approverInfo.nextApprover,10) == parseInt(purchaser))
                    )
                     &&
                    (numberOfEscalation < maxNumberOfEscalation)
                ) {

                log.debug({
                    title: '_determineCostCenterNextApprover',
                    details: '(!approverInfo.nextApprover): ' + (!approverInfo.nextApprover) + ' OR '
                });

                log.debug({
                    title: '_determineCostCenterNextApprover',
                    details: '(parseInt(lastapprover,10) == parseInt(approverInfo.nextApprover,10)): ' + (parseInt(lastapprover,10) == parseInt(approverInfo.nextApprover,10)) + ' OR '
                });

                log.debug({
                    title: '_determineCostCenterNextApprover',
                    details: '(parseInt(approverInfo.nextApprover,10) == parseInt(purchaser): ' + (parseInt(approverInfo.nextApprover,10) == parseInt(purchaser)) + ' OR '
                });

                log.debug({
                    title: '_determineCostCenterNextApprover',
                    details: '(approverInfo.canApproveAmountTo < approvalAmount): ' + (approverInfo.canApproveAmountTo < approvalAmount)
                });

                log.debug({
                    title: '_determineCostCenterNextApprover',
                    details: '&& (numberOfEscalation < maxNumberOfEscalation): ' + (numberOfEscalation < maxNumberOfEscalation)
                });

                if (approverInfo.nextApprover == 'NOT FOUND' || approverInfo.nextApprover == 'NOT CONFIGURED'){
                    log.error({
                        title: '_determineCostCenterNextApprover',
                        details: 'the system is not configured for the case: purchaser: ' + purchaser + ' approvalAmount: ' + approvalAmount+ ' approvalCostCenterRuleId: ' + approvalCostCenterRuleId
                    });

                    GLB_escalationLog += '\nThe system its wrongly configured. ' +
                        'The next approver its not defined (NOT FOUND) or his approval limit its not configured (NOT CONFIGURED) ' +
                        ': ' +approverInfo.nextApprover + 'cost center ' + approvalCostCenterRuleId + ' name ' + CCRuleIdToNameMap[approvalCostCenterRuleId];


                    numberOfEscalation = maxNumberOfEscalation;
                } else {
                    approverInfo = _determineNextApprover(purchaser, approvalAmount, approvalCostCenterRuleId, approverInfo, AllLevelsAllApproving, lastapprover, numberOfEscalation);
                    numberOfEscalation ++
                }

                if (numberOfEscalation >= maxNumberOfEscalation){
                    GLB_escalationLog += '\nReached the maximum number of escalations'
                }

                if (!approverInfo.nextApprover){
                    GLB_escalationLog += '\nThe next approver its empty'
                }

                if (parseInt(approverInfo.nextApprover,10) == parseInt(purchaser)){
                    GLB_escalationLog += '\nThe selected approver id  is the purhaser, escalating'
                }

                if (approverInfo.canApproveAmountTo < approvalAmount){
                    GLB_escalationLog += '\nThe approval amount '+approverInfo.canApproveAmountTo+' its not sufficient, to be approved amount ('+approvalAmount+'), escalating'
                }

            }

            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'WHILE DONE'
            });

            if (approverInfo){
                nextApprover = {}
                nextApprover.nextApprover = approverInfo.nextApprover;
                nextApprover.wasTheLastApproval = false;

                if (approverInfo.realApproveAmountTo >= approvalAmount){
                    nextApprover.wasTheLastApproval = true;
                }
            }

            if (numberOfEscalation == maxNumberOfEscalation){
                nextApprover = null;
            }
        } else {
            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'Cant determine next approver, missing Approval Cost Center OR Approval amount OR purchaser'
            });

            GLB_escalationLog += '\nCant determine next approver, missing Approval Cost Center Rule Id ('+approvalCostCenterRuleId+') OR Approval amount ('+approvalAmount+') OR purchaser ('+purchaser+')'
        }

        log.audit({
            title: '_determineCostCenterNextApprover',
            details: 'returning next approver as: ' + JSON.stringify(nextApprover)
        });


        return nextApprover

    }


    return {
        onAction: _handleWFAction
    };
});

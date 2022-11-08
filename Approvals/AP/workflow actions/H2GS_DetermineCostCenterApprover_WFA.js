/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */
define(['N/search', 'N/currency'], function(search, N_currency) {

    const maxNumberOfEscalation = 10;
    const unlimitedAmountForAllEscalationLevels = 100000000000;
    const approvalCurrency = 1; // SEK since there is no currency in the approval limit field we are assuming we will configure all employees approval limits in SEK

    // This workflow action it's executed in the workflow stages:
    // - Determine Cost Center Approver of the workflow [H2GS][AF] Purchase Requisition Approval // TODO other usages after implementation
    // the action it's executed before submitting the record, both in create / edit event

    var GLB_escalationLog = '';
    var EmployeeIdToNameMap = {};
    var CCIdToNameMap = {};

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
        const AllLevelsAllApproving = true;

        log.audit({
            title: '_handleWFAction core',
            details: 'workflowId: ' + workflowId + ' eventType: ' + eventType + ' recordId: ' + recordId
        });

        // Generating a map ID-> name for employee record so that logs will be OK from a user UI pov
        EmployeeIdToNameMap = _getRecordIdToNameMap('employee', 'entityid')
        // Generating a map ID-> name for cost center record so that logs will be OK from a user UI pov
        CCIdToNameMap = _getRecordIdToNameMap('department', 'name')

        // Determine next approver
        var nextApproverId = null;
        var wasTheLastApproval = false;
        var nextApproverRetObj = _determineCostCenterNextApprover(newRecord, AllLevelsAllApproving);

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

        // returning the value to the workflow. In this moment its not needed since the set field values it's inside this fucntion since are multiple
        // if in the future we will need to handle the return value in the workflow the function it's already hadnling it
        return nextApproverId;

    };

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

    function _getCostCenterManager(approvalCostCenter, AllLevelsAllApproving){

        var departmentSearchObj = search.create({
            type: "department",
            filters:
                [
                    ["internalid","anyof",approvalCostCenter]
                ],
            columns:
                [
                    search.createColumn({
                        name: "name",
                        sort: search.Sort.ASC,
                        label: "Name"
                    }),
                    search.createColumn({name: "custrecord_h2gs_af_cc_approver", label: "[H2G][AF] Cost Center Approver"}),
                    search.createColumn({
                        name: "purchaseorderapprovallimit",
                        join: "CUSTRECORD_H2GS_AF_CC_APPROVER",
                        label: "Purchase Approval Limit"
                    }),
                    search.createColumn({
                        name: "custrecord_h2gs_af_cc_approver",
                    })
                ]
        });
        var searchResultCount = departmentSearchObj.runPaged().count;

        log.debug("departmentSearchObj result count",searchResultCount);

        var costCenterManagerInfo = null;
        departmentSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results

            costCenterManagerInfo = {};
            costCenterManagerInfo.nextApprover = 'NOT CONFIGURED'
            costCenterManagerInfo.canApproveAmountTo = 0;
            costCenterManagerInfo.realApproveAmountTo = 0;

            var searchCostCenterApprover = result.getValue({
                name: 'custrecord_h2gs_af_cc_approver'
            });

            if (searchCostCenterApprover){
                costCenterManagerInfo.nextApprover = searchCostCenterApprover;
            }

            var approvalLimit = result.getValue({
                name: 'purchaseorderapprovallimit',
                join: 'CUSTRECORD_H2GS_AF_CC_APPROVER'
            });

            log.debug({
                title: '_getCostCenterManager',
                details: 'approval limit from search: ' + approvalLimit
            });

            if (approvalLimit){
                costCenterManagerInfo.canApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
                costCenterManagerInfo.realApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
            } else {
                costCenterManagerInfo.canApproveAmountTo = 0;
                costCenterManagerInfo.realApproveAmountTo = 0;
            }

            if (AllLevelsAllApproving){

                log.audit({
                    title: '_getCostCenterManager',
                    details: 'All levels will approve, so the approval limit its set to unlimitedAmountForAllEscalationLevels'
                });

                costCenterManagerInfo.canApproveAmountTo = unlimitedAmountForAllEscalationLevels;
            }

            return true;
        });

        if (costCenterManagerInfo){
            return costCenterManagerInfo;
        } else {
            return {
                nextApprover: 'NOT FOUND',
                canApproveAmountTo: 0,
                realApproveAmountTo: 0,
            };
        }


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
            nextApproverInfo.realApproveAmountTo = 0;

            if (nextApproverInfo.nextApprover && nextApproverInfo.nextApprover != 'NOT CONFIGURED'){
                var approvalLimit = _getEmployeeApprovalLimit(nextApproverInfo.nextApprover)

                log.debug({
                    title: '_getNextApprover',
                    details: 'approval limit from search: ' + approvalLimit + ' next approver: ' + nextApproverInfo.nextApprover
                });

                if (approvalLimit){
                    nextApproverInfo.canApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
                    nextApproverInfo.realApproveAmountTo = Math.round(parseFloat(approvalLimit)*100)/100;
                } else {
                    nextApproverInfo.canApproveAmountTo = 0;
                    nextApproverInfo.realApproveAmountTo = 0;
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
                canApproveAmountTo: 0,
                realApproveAmountTo: 0
            };
        }
    }

    function _determineNextApprover(purchaser, approvalAmount, approvalCostCenter, approverInfo, AllLevelsAllApproving, lastapprover, numberOfEscalation){

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
                GLB_escalationLog += '\nGot id ' + costCenterManagerInfo.nextApprover + '  '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' as approver, can approve amount to (discarded because everyone will approve): ' + costCenterManagerInfo.realApproveAmountTo
            } else {
                GLB_escalationLog += '\nGot id ' + costCenterManagerInfo.nextApprover + '  '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' as approver, can approve amount to: ' + costCenterManagerInfo.realApproveAmountTo
            }

            log.debug({
                title: '_determineNextApprover',
                details: 'costCenterManagerInfo from _getNextApprover: ' + JSON.stringify(costCenterManagerInfo)
            });

            return costCenterManagerInfo
        } else {
            log.audit({
                title: '_determineNextApprover',
                details: 'first approval, need to determine cost center first approver for cost center: ' + approvalCostCenter
            });

            GLB_escalationLog += '\nFirst approval, getting cost center manager for cost center id ' + approvalCostCenter + ' name ' + CCIdToNameMap[approvalCostCenter]
            var costCenterManagerInfo = _getCostCenterManager(approvalCostCenter, AllLevelsAllApproving);

            if (AllLevelsAllApproving){
                GLB_escalationLog += '\nCost Center Manager determined id ' + costCenterManagerInfo.nextApprover + ' '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' can approve amount to (discarded because everyone will approve): ' + costCenterManagerInfo.realApproveAmountTo
            } else {
                GLB_escalationLog += '\nCost Center Manager determined id ' + costCenterManagerInfo.nextApprover + ' '+_getEmployeeNameFromId(costCenterManagerInfo.nextApprover)+' can approve amount to: ' + costCenterManagerInfo.realApproveAmountTo
            }


            log.debug({
                title: '_determineNextApprover',
                details: 'costCenterManagerInfo from _getCostCenterManager: ' + JSON.stringify(costCenterManagerInfo)
            });

            return costCenterManagerInfo
        }

    }


    function _determineCostCenterNextApprover(newRecord, AllLevelsAllApproving){
        // determine purchaser
        const purchaser = newRecord.getValue('custbody_h2gs_af_purchaser');
        // determine last approver, if empty then this is the first approval else it means that we need to escalate
        const lastapprover = newRecord.getValue('custbody_h2gs_af_current_approver');
        // determine approval cost center
        const approvalCostCenter = newRecord.getValue('custbody_h2gs_af_cc_for_approvals');
        // determine the approval amount in SEK for the current transaction
        var approvalAmountS = newRecord.getValue('estimatedtotal');
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
            details: 'purchaser: ' + purchaser + ' lastapprover: ' + lastapprover+ ' approvalCostCenter: ' + approvalCostCenter+ ' approvalAmount: ' + approvalAmount+ ' approvalAmountSEK: ' + approvalAmountSEK
        });

        // TODO better to replace the variable approvalAmount with approvalAmountSEK for better code reading in other functions
        // running against time so adding the TODO
        approvalAmount = approvalAmountSEK;

        var nextApprover = null;

        if (approvalCostCenter && approvalAmount && purchaser){

            log.audit({
                title: '_determineCostCenterNextApprover',
                details: 'determining next approver'
            });

            var approverInfo = {};
            approverInfo.canApproveAmountTo = 0;
            approverInfo.realApproveAmountTo = 0;
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
                        details: 'the system is not configured for the case: purchaser: ' + purchaser + ' approvalAmount: ' + approvalAmount+ ' approvalCostCenter: ' + approvalCostCenter
                    });

                    GLB_escalationLog += '\nThe system its wrongly configured. ' +
                        'The next approver its not defined (NOT FOUND) or his approval limit its not configured (NOT CONFIGURED) ' +
                        ': ' +approverInfo.nextApprover + 'cost center ' + approvalCostCenter + ' name ' + CCIdToNameMap[approvalCostCenter];


                    numberOfEscalation = maxNumberOfEscalation;
                } else {
                    approverInfo = _determineNextApprover(purchaser, approvalAmount, approvalCostCenter, approverInfo, AllLevelsAllApproving, lastapprover, numberOfEscalation);
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
        }

        log.audit({
            title: '_determineCostCenterNextApprover',
            details: 'returning next approver as: ' + nextApprover
        });


        return nextApprover

    }


    return {
        onAction: _handleWFAction
    };
});

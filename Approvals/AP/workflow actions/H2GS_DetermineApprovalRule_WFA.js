/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */
define(['N/search', 'N/currency'], function(search, currency) {

    const costCenterFieldId = 'department';

    // This workflow action it's executed in the workflow stages:
    // - Determine Cost Center of the workflow [H2GS][AF] Purchase Requisition Approval
    // - Determine Cost Center of the workflow [H2GS][AF] Purchase Order Approval

    // the action it's executed before submitting the record, both in create / edit event

    // the goal of the entry point it's to determine the cost center that will drive the approval
    // loop all items and expenses lines reading the selected cost center and store in the field
    // [H2G][AF] APPROVAL COST CENTER custbody_h2gs_af_approvalrule the value of the determined cost center
    // if it's not possible to determine a cost center (not used in both sublists) then we will not set any value in that field
    // and the workflow will stay in the stage Pending Cost Center Selection
    function _handleWFAction(scriptContext) {
        log.audit({
            title: '_handleWFAction approvalRuleId',
            details: 'start'
        });

        const oldRecord = scriptContext.oldRecord;
        const newRecord = scriptContext.newRecord;
        const workflowId = scriptContext.workflowId;
        const eventType = scriptContext.type;
        const recordId = newRecord.id;

        log.audit({
            title: '_handleWFAction approvalRuleId',
            details: 'workflowId: ' + workflowId + ' eventType: ' + eventType + ' recordId: ' + recordId
        });

        // Change in scope. We are now determining an approval rule given the header department and branch (location)
        // instead of the most used cost center
        //var costCenterId = _determineApprovalCostCenter(newRecord);
        const recordType = newRecord.getValue('type');

        if (recordType){
            var approvalRuleId = _determineApprovalRuleForTransactionType(newRecord, recordType)

            log.audit({
                title: '_handleWFAction approvalRuleId',
                details: 'got approvalRuleId: ' + approvalRuleId
            });

            if(approvalRuleId){
                log.audit({
                    title: '_handleWFAction approvalRuleId',
                    details: 'setting approvalRuleId: ' + approvalRuleId
                });

                newRecord.setValue('custbody_h2gs_af_approvalrule', approvalRuleId)
            }
        }

        log.audit({
            title: '_handleWFAction approvalRuleId',
            details: 'end, return approvalRuleId: ' + approvalRuleId
        });

        return approvalRuleId;

    }

    function _determineApprovalRuleForTransactionType(newRecord, recordType) {

        log.audit({
            title: '_determineApprovalRuleForTransactionType',
            details: 'recordType: ' + recordType
        });

        switch (recordType){
            case 'purchreq':
            case 'purchord':
                var approvalRuleId = _getApprovalRuleGeneric(newRecord);
                break;
        }

        return approvalRuleId;

    }

    function _getApprovalRuleGeneric(newRecord) {
        var approvalRuleId = null;

        const departmentId = newRecord.getValue('department');
        const locationId = newRecord.getValue('location');

        log.debug({
            title: '_getApprovalRuleGeneric',
            details: 'departmentId: ' + departmentId
        });

        log.debug({
            title: '_getApprovalRuleGeneric',
            details: 'locationId: ' + locationId
        });

        if ((departmentId) && (locationId)){
            var ApprovalRuleSearchObj = search.create({
                type: 'customrecord_h2gf_af_approval_rule',
                filters: [
                        ["custrecordd_h2gf_af_ar_department","anyof",departmentId],
                        "AND",
                        ["custrecordd_h2gf_af_ar_location","anyof",locationId]
                    ],
                columns:
                    [
                        search.createColumn({name: "internalid"}),
                        search.createColumn({name: "name"}),
                    ]
            });

            var ApprovalRuleSearchObjCount = ApprovalRuleSearchObj.runPaged().count;

            log.debug({
                title: '_getApprovalRuleGeneric',
                details: 'ApprovalRuleSearchObjCount search rules result count: ' + ApprovalRuleSearchObjCount
            });

            var approvalRuleRes = null;
            ApprovalRuleSearchObj.run().each(function(result){
                // .run().each has a limit of 4,000 results

                approvalRuleRes = result.getValue({
                    name: 'internalid'
                });

                if (approvalRuleRes){
                    approvalRuleId = approvalRuleRes;
                }

                return true;
            });
        }

        log.debug({
            title: '_getApprovalRuleGeneric',
            details: 'returning: ' + approvalRuleId
        });

        return approvalRuleId
    }

    // DEPRECATED FUNCTIONS, KEEPING THEM FOR CV PURPOSE AND UNTILL IT WILL NOT BE FULLY TESTED / APPROVED
    // IN CASE ANYTHING WE DID PREVIOUSLY WILL BE NEEDED

    function _determineApprovalCostCenter(newRecord) {
        // determine the type of the record since this function will be shared across multiple
        // workflows with slightly different behaviors

        var costCenterId = null;
        const recordType = newRecord.getValue('type');

        costCenterId = _determineApprovalCostCenterForTransactionType_Sublist(newRecord, recordType)

        return costCenterId;

    }

    // determine the approval cost center for a specific transaction type
    // deprecating this function since now the "most used cost center" is no longer got from
    // lines most used department. It will be a combination of header department and location
    function _determineApprovalCostCenterForTransactionType_Sublist(newRecord, recordType) {

        log.audit({
            title: '_determineApprovalCostCenterForTransactionType_Sublist',
            details: 'recordType: ' + recordType
        });

        switch (recordType){
            case 'purchreq':
            case 'purchord':
                // get most used CostCenter from expenses and item sublist
                var MostUsedExpensesCostCenter = _getMostUsedCostCenterFromSublist('expense',newRecord);
                var MostUsedItemsCostCenter = _getMostUsedCostCenterFromSublist('item',newRecord);

                log.audit({
                    title: '_determineApprovalCostCenterForTransactionType_Sublist',
                    details: 'mostUsedExpensesCostCenter: ' + JSON.stringify(MostUsedExpensesCostCenter)
                });

                log.audit({
                    title: '_determineApprovalCostCenterForTransactionType_Sublist',
                    details: 'mostUsedItemsCostCenter: ' + JSON.stringify(MostUsedItemsCostCenter)
                });

                // compare the number of occurrencies of specific deparments and return the most used

                // if 1 of the 2 sublist contains a CostCenter
                if (MostUsedItemsCostCenter || MostUsedExpensesCostCenter){

                    log.audit({
                        title: '_determineApprovalCostCenterForTransactionType_Sublist',
                        details: 'item or expenses sublist its containing at least 1 cost center'
                    });

                    if (!MostUsedItemsCostCenter){

                        log.audit({
                            title: '_determineApprovalCostCenterForTransactionType_Sublist',
                            details: 'no cost centers used in items sublist, returning expenses CostCenter: ' + MostUsedExpensesCostCenter.CostCenterId
                        });

                        return MostUsedExpensesCostCenter.CostCenterId;
                    } else {
                        if (!MostUsedExpensesCostCenter){

                            log.audit({
                                title: '_determineApprovalCostCenterForTransactionType_Sublist',
                                details: 'no cost centers used in expenses sublist, returning items CostCenter: ' + MostUsedItemsCostCenter.CostCenterId
                            });

                            return MostUsedItemsCostCenter.CostCenterId;
                        } else {

                            if (MostUsedItemsCostCenter.usage >= MostUsedExpensesCostCenter.usage){
                                log.audit({
                                    title: '_determineApprovalCostCenterForTransactionType_Sublist',
                                    details: 'cost centers used in both expenses and items sublist, returning the most used from items: ' + MostUsedItemsCostCenter.CostCenterId
                                });

                                return MostUsedItemsCostCenter.CostCenterId;
                            } else {
                                log.audit({
                                    title: '_determineApprovalCostCenterForTransactionType_Sublist',
                                    details: 'cost centers used in both expenses and items sublist, returning the most used from expenses: ' + MostUsedExpensesCostCenter.CostCenterId
                                });

                                return MostUsedExpensesCostCenter.CostCenterId;
                            }
                        }
                    }
                }
                break;
        }

        return null;

    }

    // return the most used cost center given a sublist id and the current record
    function _getMostUsedCostCenterFromSublist(sublistId, newRecord){
        const linesCount = newRecord.getLineCount(sublistId);

        var costCenterCount = {};

        for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){
            var currentCostCenter = newRecord.getSublistValue({
                sublistId: sublistId,
                fieldId: costCenterFieldId,
                line: iCountSublistLines
            });

            if (currentCostCenter){
                if (typeof costCenterCount[currentCostCenter] == 'undefined'){
                    costCenterCount[currentCostCenter] = {};
                    costCenterCount[currentCostCenter].CostCenterId = currentCostCenter;
                    costCenterCount[currentCostCenter].countInstances = 0;
                }

                costCenterCount[currentCostCenter].countInstances++
            }

        }

        log.debug({
            title: '_getMostUsedCostCenterFromSublist ' + sublistId,
            details: 'costCenterCount: ' + JSON.stringify(costCenterCount)
        });

        var mostUsedCostCenter = null;
        for (var CostCenterId in costCenterCount) {
            var currentDeparmentUsage = costCenterCount[CostCenterId].countInstances;

            if (!mostUsedCostCenter){

                log.debug({
                    title: '_getMostUsedCostCenterFromSublist ' + sublistId,
                    details: 'dont have a current most used CostCenter, assigning deparment: ' + CostCenterId + ' with an usage of: ' + currentDeparmentUsage
                });

                mostUsedCostCenter = {}
                mostUsedCostCenter.usage = currentDeparmentUsage;
                mostUsedCostCenter.CostCenterId = CostCenterId;
            } else {

                log.debug({
                    title: '_getMostUsedCostCenterFromSublist ' + sublistId,
                    details: 'have a current most used CostCenter '+mostUsedCostCenter.CostCenterId+' usage: ' + mostUsedCostCenter.usage + ' comparing with currentDeparmentUsage: ' + currentDeparmentUsage+ ' current most used CostCenterId: ' + CostCenterId
                });

                if (currentDeparmentUsage > mostUsedCostCenter.usage){

                    log.debug({
                        title: '_getMostUsedCostCenterFromSublist ' + sublistId,
                        details: 'its greater than previous, new most used CostCenter '+CostCenterId
                    });

                    mostUsedCostCenter.usage = currentDeparmentUsage
                    mostUsedCostCenter.CostCenterId = CostCenterId;
                } else {
                    log.debug({
                        title: '_getMostUsedCostCenterFromSublist ' + sublistId,
                        details: 'its not greater than previous, kept same most used CostCenter '+mostUsedCostCenter.CostCenterId
                    });
                }
            }
        }

        return mostUsedCostCenter;
    }
    // END OF DEPRECATED FUNCTIONS


    return {
        onAction: _handleWFAction
    };
});

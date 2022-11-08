/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */
define(['N/search', 'N/currency'], function(search, currency) {

    const costCenterFieldId = 'department';

    // This workflow action it's executed in the workflow stages:
    // - Determine Cost Center of the workflow [H2GS][AF] Purchase Requisition Approval // TODO other usages after implementation
    // the action it's executed before submitting the record, both in create / edit event

    // the goal of the entry point it's to determine the cost center that will drive the approval
    // loop all items and expenses lines reading the selected cost center and store in the field
    // [H2G][AF] APPROVAL COST CENTER custbody_h2gs_af_cc_for_approvals the value of the determined cost center
    // if it's not possible to determine a cost center (not used in both sublists) then we will not set any value in that field
    // and the workflow will stay in the stage Pending Cost Center Selection
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

        log.audit({
            title: '_handleWFAction core',
            details: 'workflowId: ' + workflowId + ' eventType: ' + eventType + ' recordId: ' + recordId
        });

        var costCenterId = _determineApprovalCostCenter(newRecord);

        if(costCenterId){
            newRecord.setValue('custbody_h2gs_af_cc_for_approvals', costCenterId)
            log.audit({
                title: '_handleWFAction',
                details: 'set cost center as: ' + costCenterId
            });
        }

        log.audit({
            title: '_handleWFAction',
            details: 'end, return costCenterId: ' + costCenterId
        });

        return costCenterId;

    }

    function _determineApprovalCostCenter(newRecord) {
        // determine the type of the record since this function will be shared across multiple
        // workflows with slightly different behaviors

        var costCenterId = null;
        const recordType = newRecord.getValue('type');

        costCenterId = _determineApprovalCostCenterForTransactionType(newRecord, recordType)

        return costCenterId;

    }

    // determine the approval cost center for a specific transaction type
    function _determineApprovalCostCenterForTransactionType(newRecord, recordType) {

        log.audit({
            title: '_determineApprovalCostCenterForTransactionType',
            details: 'recordType: ' + recordType
        });

        switch (recordType){
            case 'purchreq':
                // get most used CostCenter from expenses and item sublist
                var MostUsedExpensesCostCenter = _getMostUsedCostCenterFromSublist('expense',newRecord);
                var MostUsedItemsCostCenter = _getMostUsedCostCenterFromSublist('item',newRecord);

                log.audit({
                    title: '_determineApprovalCostCenterForTransactionType',
                    details: 'mostUsedExpensesCostCenter: ' + JSON.stringify(MostUsedExpensesCostCenter)
                });

                log.audit({
                    title: '_determineApprovalCostCenterForTransactionType',
                    details: 'mostUsedItemsCostCenter: ' + JSON.stringify(MostUsedItemsCostCenter)
                });

                // compare the number of occurrencies of specific deparments and return the most used

                // if 1 of the 2 sublist contains a CostCenter
                if (MostUsedItemsCostCenter || MostUsedExpensesCostCenter){

                    log.audit({
                        title: '_determineApprovalCostCenterForTransactionType',
                        details: 'item or expenses sublist its containing at least 1 cost center'
                    });

                    if (!MostUsedItemsCostCenter){

                        log.audit({
                            title: '_determineApprovalCostCenterForTransactionType',
                            details: 'no cost centers used in items sublist, returning expenses CostCenter: ' + MostUsedExpensesCostCenter.CostCenterId
                        });

                        return MostUsedExpensesCostCenter.CostCenterId;
                    } else {
                        if (!MostUsedExpensesCostCenter){

                            log.audit({
                                title: '_determineApprovalCostCenterForTransactionType',
                                details: 'no cost centers used in expenses sublist, returning items CostCenter: ' + MostUsedItemsCostCenter.CostCenterId
                            });

                            return MostUsedItemsCostCenter.CostCenterId;
                        } else {

                            if (MostUsedItemsCostCenter.usage >= MostUsedExpensesCostCenter.usage){
                                log.audit({
                                    title: '_determineApprovalCostCenterForTransactionType',
                                    details: 'cost centers used in both expenses and items sublist, returning the most used from items: ' + MostUsedItemsCostCenter.CostCenterId
                                });

                                return MostUsedItemsCostCenter.CostCenterId;
                            } else {
                                log.audit({
                                    title: '_determineApprovalCostCenterForTransactionType',
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

    return {
        onAction: _handleWFAction
    };
});

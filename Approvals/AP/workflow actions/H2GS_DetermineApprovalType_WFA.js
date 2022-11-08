/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */
define(['N/search','N/runtime'], function(searchModule, runtimeModule) {

    const PurchaseRequisitionFlow = 1;
    const PurchaseContractFlow = 2;
    const FreePurchaseOrderFlow = 3;
    const PurchaseRequisitionAndContractFlow = 5;

    function _handleWFAction(scriptContext) {
        log.audit({
            title: '_handleWFAction approval type',
            details: 'start'
        });

        const oldRecord = scriptContext.oldRecord;
        const newRecord = scriptContext.newRecord;
        const workflowId = scriptContext.workflowId;
        const eventType = scriptContext.type;
        const recordId = newRecord.id;

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'workflowId: ' + workflowId + ' eventType: ' + eventType + ' recordId: ' + recordId
        });

        var executionContext = runtimeModule.executionContext;

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'executionContext: ' + executionContext
        });

        var createdFromRequisition = _isCreatedFromRequisition(newRecord)

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'createdFromRequisition: ' + createdFromRequisition
        });

        var createdReferringToPurchaseContract = _isReferringAPurchaseContract(newRecord)

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'createdReferringToPurchaseContract: ' + createdReferringToPurchaseContract
        });

        var orderTypeToSet = null;
        if (createdFromRequisition && createdReferringToPurchaseContract){
            orderTypeToSet = PurchaseRequisitionAndContractFlow; // referring to both requisitions and contract

            log.debug({
                title: '_handleWFAction determineApprovalType',
                details: 'flow type PurchaseRequisitionAndContractFlow'
            });
        } else {
            if (createdFromRequisition || createdReferringToPurchaseContract){
                if (createdFromRequisition){
                    orderTypeToSet = PurchaseRequisitionFlow; // created from a requisition

                    log.debug({
                        title: '_handleWFAction determineApprovalType',
                        details: 'flow type PurchaseRequisitionFlow'
                    });
                } else {
                    orderTypeToSet = PurchaseContractFlow; // created from a contract

                    log.debug({
                        title: '_handleWFAction determineApprovalType',
                        details: 'flow type PurchaseContractFlow'
                    });
                }
            } else {
                orderTypeToSet = FreePurchaseOrderFlow; // Free purhcase order flow

                log.debug({
                    title: '_handleWFAction determineApprovalType',
                    details: 'flow type FreePurchaseOrderFlow'
                });
            }
        }

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'orderTypeToSet: ' + orderTypeToSet
        });

        if (orderTypeToSet){
            newRecord.setValue('custbody_h2gs_af_approval_type', orderTypeToSet)
        }

        return orderTypeToSet;
    }

    function _isReferringAPurchaseContract(newRecord){

        var expensesReferAcontract = _checkSublistValueItsPopulated(newRecord, 'expense','purchasecontract')
        var itemsReferAcontract = _checkSublistValueItsPopulated(newRecord,'item','purchasecontract')
        var referToAPurchaseContractHeader = (newRecord.getValue('headerpurchasecontract'));

        log.audit({
            title: '_isReferringAPurchaseContract',
            details: 'expensesReferAcontract: ' + expensesReferAcontract + ' itemsReferAcontract ' + itemsReferAcontract + ' referToAPurchaseContractHeader ' + referToAPurchaseContractHeader
        });



        return (expensesReferAcontract || itemsReferAcontract || referToAPurchaseContractHeader)
    }

    function _isCreatedFromRequisition(newRecord){

        var expensesReferARequisition = _checkSublistValueItsPopulated(newRecord, 'expense','linkedorder')
        var itemsReferARequisition = _checkSublistValueItsPopulated(newRecord,'item','linkedorder')

        log.audit({
            title: '_isCreatedFromRequisition',
            details: 'expensesReferARequisition: ' + expensesReferARequisition + ' itemsReferARequisition ' + itemsReferARequisition
        });

        return (expensesReferARequisition || itemsReferARequisition)
    }

    function _checkSublistValueItsPopulated(newRecord, sublistId, fieldToCheck){
        const linesCount = newRecord.getLineCount(sublistId);

        log.audit({
            title: '_checkSublistValueItsPopulated',
            details: 'linesCount: ' + linesCount + ' sublist ' + sublistId
        });

        for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){
            var currentFieldToCheckValue = newRecord.getSublistValue({
                sublistId: sublistId,
                fieldId: fieldToCheck,
                line: iCountSublistLines
            });

            log.debug({
                title: '_checkSublistValueItsPopulated',
                details: 'currentFieldToCheckValue: ' + currentFieldToCheckValue + ' fieldToCheck ' + fieldToCheck + ' line ' + iCountSublistLines
            });

            log.debug({
                title: '_checkSublistValueItsPopulated',
                details: 'parseInt(currentFieldToCheckValue,10): ' + parseInt(currentFieldToCheckValue,10)
            });

            log.debug({
                title: '_checkSublistValueItsPopulated',
                details: 'isNaN(parseInt(currentFieldToCheckValue,10)): ' + isNaN(parseInt(currentFieldToCheckValue,10))
            });

            // we are expexting an ID as a return value
            if (!isNaN(parseInt(currentFieldToCheckValue,10))){

                log.audit({
                    title: '_checkSublistValueItsPopulated',
                    details: 'returning true for line: ' + iCountSublistLines
                });

                return true
            }
        }

        log.audit({
            title: '_checkSublistValueItsPopulated',
            details: 'did not find a value, returning false'
        });

        return false
    }

    return {
        onAction: _handleWFAction
    };
});

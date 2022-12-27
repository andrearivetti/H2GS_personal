/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */
define(['N/search','N/runtime'], function(searchModule, runtimeModule) {

    // THIS SCRIPT IT'S DETERMINING THE APPROVAL TYPE IN THE WORKFLOWS
    //
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
        const executionContext = runtimeModule.executionContext;
        const currentUser = runtimeModule.getCurrentUser().id;

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'workflowId: ' + workflowId + ' eventType: ' + eventType + ' recordId: ' + recordId + ' executionContext: ' + executionContext + ' currentUser: ' + currentUser
        });

        var currentApprovalType = newRecord.getValue('custbody_h2gs_af_approval_type')

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'currentApprovalType: ' + currentApprovalType
        });

        if (!currentApprovalType){

            log.audit({
                title: '_handleWFAction determineApprovalType',
                details: 'No approval type, determining if free vendor bill or there are purchase orders linked: ' + currentApprovalType
            });

            var createdFromSublistid = 'purchaseorders';

            var POrelatedResult = _checkSublistValueItsPopulatedAndItsASingleResult(newRecord, createdFromSublistid, 'id');

            log.audit({
                title: '_handleWFAction determineApprovalType',
                details: 'POrelatedResult: ' + JSON.stringify(POrelatedResult)
            });

            var poIsMatchingVB = false;
            if (POrelatedResult.fieldExist){
                if (POrelatedResult.numberOfOccurrences == 1){
                    if (POrelatedResult.poId > 0){
                        poIsMatchingVB = true;
                    }
                }
            }

            log.audit({
                title: '_handleWFAction determineApprovalType',
                details: 'poIsMatchingVB: ' + poIsMatchingVB
            });



            if (poIsMatchingVB){

                log.audit({
                    title: '_handleWFAction determineApprovalType',
                    details: 'setting approval type as 6, vendor bill and purchase order'
                });

                newRecord.setValue('custbody_h2gs_af_approval_type', 6) // vendor bill and purchase order
            } else {

                log.audit({
                    title: '_handleWFAction determineApprovalType',
                    details: 'setting approval type as 4, free vendor bill'
                });

                newRecord.setValue('custbody_h2gs_af_approval_type', 4) // free vendor bill
            }

        } else {
            log.audit({
                title: '_handleWFAction determineApprovalType',
                details: 'Inheriting approval type from previous record: ' + currentApprovalType
            });
        }



    }

    function _checkSublistValueItsPopulatedAndItsASingleResult(newRecord, sublistId, fieldToCheck){
        var linesCount = newRecord.getLineCount(sublistId);

        log.audit({
            title: '_checkSublistValueItsPopulated',
            details: 'linesCount: ' + linesCount + ' sublist ' + sublistId
        });

        var returnObj = {};
        returnObj.fieldExist = false;
        returnObj.poId = null;
        returnObj.numberOfOccurrences = 0;

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

                returnObj.poId = currentFieldToCheckValue;

                returnObj.numberOfOccurrences++
            }
        }

        log.audit({
            title: '_checkSublistValueItsPopulated',
            details: 'returnObj.numberOfOccurrences: ' + returnObj.numberOfOccurrences
        });

        if (returnObj.numberOfOccurrences > 0){
            returnObj.fieldExist = true;
        }

        return returnObj;
    }

    return {
        onAction: _handleWFAction
    };
});

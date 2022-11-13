/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */
define(['N/search','N/runtime'], function(searchModule, runtimeModule) {

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

        var employeesWhoApprovedList = newRecord.getValue('custbody_h2gs_list_of_approvers')

        log.audit({
            title: '_handleWFAction determineApprovalType',
            details: 'employeesWhoApprovedList ' + JSON.stringify(employeesWhoApprovedList)
        });

        var delimiter = /\u0005/;
        // escalation
        if (employeesWhoApprovedList.length){
            if (employeesWhoApprovedList.length > 0){

                log.audit({
                    title: '_handleWFAction determineApprovalType',
                    details: 'adding current user ' + currentUser
                });

                employeesWhoApprovedList.push(currentUser);

                log.audit({
                    title: '_handleWFAction determineApprovalType',
                    details: 'new list of employees who approved ' + JSON.stringify(employeesWhoApprovedList)
                });

                newRecord.setValue('custbody_h2gs_list_of_approvers', employeesWhoApprovedList)
            } else {
                // first approval
                newRecord.setValue('custbody_h2gs_list_of_approvers', currentUser)
            }
        }else {
            // first approval
            newRecord.setValue('custbody_h2gs_list_of_approvers', currentUser)
        }



    }

    return {
        onAction: _handleWFAction
    };
});

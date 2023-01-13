/**
 * @NApiVersion 2.0
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', "N/search", 'N/runtime'],
    /**
     * @param {record} record
     * @param {currency} currency
     */
    function(recordModule,searchModule, runtimeModule) {

        const testFromUIActive = true;

        function _handleRest_BL(scriptContext) {

            log.audit({
                title: '_handleRest_BL',
                details: 'START'
            });

            var fieldsToSetADefaultFor = {};
            fieldsToSetADefaultFor['item'] = [];
            fieldsToSetADefaultFor['item'].push({
                targetFieldId: 'taxschedule',
                defaultValue: '2'
            });

            var form = scriptContext.form
            var newRecord = scriptContext.newRecord;

            if (form){
                const recordType = newRecord.getValue('type');

                if (typeof fieldsToSetADefaultFor[recordType] != 'undefined'){
                    if (typeof fieldsToSetADefaultFor[recordType].length != 'undefined'){
                        var currentFieldConfig;
                        for (var iCountfieldsToSetADefaultForForRecordType = 0; iCountfieldsToSetADefaultForForRecordType < fieldsToSetADefaultFor[recordType].length ; iCountfieldsToSetADefaultForForRecordType++){
                            currentFieldConfig = fieldsToSetADefaultFor[recordType][iCountfieldsToSetADefaultForForRecordType];

                            if ((currentFieldConfig.targetFieldId) && (currentFieldConfig.defaultValue)){

                                if (!newRecord.getValue(currentFieldConfig.targetFieldId)){

                                    log.audit({
                                        title: '_handleRest_BL',
                                        details: 'Setting default value: ' + currentFieldConfig.defaultValue + ' for field: ' + currentFieldConfig.targetFieldId
                                    });

                                    var toSetDefaultField = form.getField(currentFieldConfig.targetFieldId);

                                    if (toSetDefaultField){
                                        log.audit({
                                            title: '_handleRest_BL',
                                            details: 'Setting default '+currentFieldConfig.targetFieldId+' value as ' + currentFieldConfig.defaultValue
                                        });

                                        toSetDefaultField.defaultValue = currentFieldConfig.defaultValue
                                    }


                                }


                            }
                        }
                    }
                }
            }

            log.audit({
                title: '_handleRest_BL',
                details: 'END'
            });
        }

        function _handleRest(scriptContext) {

            var fieldsToClone = {};
            fieldsToClone['vendor'] = [];
            fieldsToClone['vendor'].push({
                sourceFieldId: 'custentity_h2g_vat_number_copy',
                targetFieldId: 'vatregnumber',
                copyIfEmpty: true
            });
            fieldsToClone['vendor'].push({
                sourceFieldId: 'custentity_h2g_vat_number_copy',
                targetFieldId: 'taxidnum',
                copyIfEmpty: true
            });
/*            fieldsToClone['item'] = [];
            fieldsToClone['item'].push({
                sourceFieldId: 'custitem_h2gs_tax_sched_clone',
                targetFieldId: 'taxschedule',
                copyIfEmpty: true
            });*/

            var newRecord = scriptContext.newRecord;
            var oldRecord = scriptContext.oldRecord;
            var event = scriptContext.type;

            var recordType = newRecord.getValue('type');

            log.audit({
                title: '_handleRest',
                details: 'recordType: ' + recordType
            });

            var executionContext = runtimeModule.executionContext;

            log.audit({
                title: '_handleRest',
                details: 'executionContext: ' + executionContext + ' event: ' + event
            });

            if (event == 'create' || event == 'edit'){
                if ((executionContext == runtimeModule.ContextType.RESTWEBSERVICES) || (testFromUIActive)){

                    _handleFieldsClone(fieldsToClone, recordType, newRecord)
                }
            }

            // not needed anymore. We moved this fix on before load since the rest it'a validating the record before running the
            // user event before submitting the record
            /*if (event == 'create' || event == 'edit'){
                if ((executionContext == runtimeModule.ContextType.RESTWEBSERVICES) || (testFromUIActive)){
                    _handleFieldsDefaultValue(fieldsToSetADefaultFor, recordType, newRecord)
                }
            }*/

            log.audit({
                title: '_handleRest',
                details: 'DONE'
            });
        }

        var _handleFieldsDefaultValue = function (fieldsToSetADefaultFor, recordType, newRecord){

            log.audit({
                title: '_handleRest',
                details: 'fieldsToSetADefaultFor: ' + JSON.stringify(fieldsToSetADefaultFor)
            });

            if (typeof fieldsToSetADefaultFor[recordType] != 'undefined'){
                if (typeof fieldsToSetADefaultFor[recordType].length != 'undefined'){
                    var currentFieldConfig;
                    for (var iCountfieldsToSetADefaultForForRecordType = 0; iCountfieldsToSetADefaultForForRecordType < fieldsToSetADefaultFor[recordType].length ; iCountfieldsToSetADefaultForForRecordType++){
                        currentFieldConfig = fieldsToSetADefaultFor[recordType][iCountfieldsToSetADefaultForForRecordType];

                        if ((currentFieldConfig.targetFieldId) && (currentFieldConfig.defaultValue)){

                            if (!newRecord.getValue(currentFieldConfig.targetFieldId)){

                                log.audit({
                                    title: '_handleRest',
                                    details: 'Setting default value: ' + currentFieldConfig.defaultValue + ' for field: ' + currentFieldConfig.targetFieldId
                                });

                                newRecord.setValue(currentFieldConfig.targetFieldId, currentFieldConfig.defaultValue)
                            }


                        }
                    }
                }
            }
        }

        var _handleFieldsClone = function (fieldsToClone, recordType, newRecord){

            log.audit({
                title: '_handleRest',
                details: 'fieldsToClone: ' + JSON.stringify(fieldsToClone)
            });

            if (typeof fieldsToClone[recordType] != 'undefined'){
                if (typeof fieldsToClone[recordType].length != 'undefined'){
                    var currentFieldConfig;
                    for (var iCountFieldsToCloneForRecordType = 0; iCountFieldsToCloneForRecordType < fieldsToClone[recordType].length ; iCountFieldsToCloneForRecordType++){
                        currentFieldConfig = fieldsToClone[recordType][iCountFieldsToCloneForRecordType];

                        if ((currentFieldConfig.sourceFieldId) && (currentFieldConfig.targetFieldId) && (currentFieldConfig.copyIfEmpty)){

                            if (!currentFieldConfig.copyIfEmpty){
                                if (newRecord.getValue(currentFieldConfig.sourceFieldId)){

                                    log.audit({
                                        title: '_handleRest',
                                        details: 'Cloning field value: ' + newRecord.getValue(currentFieldConfig.sourceFieldId) + ' to field: ' + currentFieldConfig.targetFieldId
                                    });

                                    newRecord.setValue(currentFieldConfig.targetFieldId, newRecord.getValue(currentFieldConfig.sourceFieldId))
                                }
                            } else {

                                log.audit({
                                    title: '_handleRest',
                                    details: 'Cloning field value: ' + newRecord.getValue(currentFieldConfig.sourceFieldId) + ' to field: ' + currentFieldConfig.targetFieldId
                                });

                                newRecord.setValue(currentFieldConfig.targetFieldId, newRecord.getValue(currentFieldConfig.sourceFieldId))
                            }


                        }
                    }
                }
            }

        }

        return {
            beforeLoad: _handleRest_BL,
            beforeSubmit: _handleRest,
            //afterSubmit: afterSubmit
        };
    });

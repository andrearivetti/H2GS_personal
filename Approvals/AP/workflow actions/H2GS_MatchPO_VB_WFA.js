/**
 *@NApiVersion 2.0
 *@NScriptType WorkflowActionScript
 */
define(['N/search','N/runtime','N/record', 'N/workflow'], function(searchModule, runtimeModule, recordModule, workflowModule) {

    const convertToInteger = true;
    const defaultMatchingStatus = 1;
    const defaultNotFoundStatus = 8;

    const StatusesToContinueMatching = [1,2,3];
    const StatusesWeCanApproveTheBill = [4,5,6,7];

    const FullyMatchingPoStatuses = [4,6,2];
    const ToleranceMatchingPoStatuses = [5,3,7];

    const FullyMatchingIRStatuses = [4,5];
    const ToleranceMatchingIRStatuses = [6, 7];

    var GLB_MatchingLogs = '';

    // TODO check multiple IR vendor bill
    // TODO use vendor bill data and not saved search data since it's not updated while edit + save
/*

1	Pending
2	PO Matched, IR Not Matched
3	PO Matched (tol), IR not Matched
4	PO Matched, IR Matched
5	PO Matched (tol), IR Matched
6	PO Matched, IR Matched (tol)
7	PO Matched (tol), IR Matched (tol)
8	PO Not Found
*/

    // if false, the system will compare net amounts, no VAT
    // for this project phase we will only test matching gross amount since not required
    // NEVER TURN THIS TO FALSE, IN THIS MOMENT THERE IS A HUGE LIMITATION THAT IS THAT VB AND IR
    // DATA ARE READ FROM SEARCH AND THERE ARE NO VAT / GROSS AMOUNTS AVAILABLE IN THAT CONTEXT IN FX CURRENCY
    // of course we are matching in FX currency since it would not make sense to unmatch because of currency flactuation
    var matchByGrossAmount = true;

    var firstSessionLog = true;

    function _handleWFAction(scriptContext) {
        log.audit({
            title: '_handleWFAction matchings',
            details: 'start'
        });

        const oldRecord = scriptContext.oldRecord;
        const newRecord = scriptContext.newRecord;
        const workflowId = scriptContext.workflowId;
        const eventType = scriptContext.type;
        const recordId = newRecord.id;
        const executionContext = runtimeModule.executionContext;
        const currentUser = runtimeModule.getCurrentUser().id;

        var MatchingStatusIdToNameMap = _getRecordIdToNameMap('customrecord_h2gs_af_matching_status', 'name')

        log.audit({
            title: '_handleWFAction matchings',
            details: 'workflowId: ' + workflowId + ' eventType: ' + eventType + ' recordId: ' + recordId + ' executionContext: ' + executionContext + ' currentUser: ' + currentUser
        });

        // working only in EDIT MODE or SCHEDULED
        if (!recordId){
            log.audit({
                title: '_handleWFAction matchings',
                details: 'start, no record ID, cannot match'
            });
        } else
        {
            var AnyPOLinked = (newRecord.getLineCount('purchaseorders')>0);

            _appendToLog(newRecord,'Matching started, po linked: ' + newRecord.getLineCount('purchaseorders'));

            if (AnyPOLinked){

                var MatchingHandler = {};

                MatchingHandler.header = {};
                MatchingHandler.items = {};
                MatchingHandler.linkedOrders = {};
                MatchingHandler.linkedItems = {};
                MatchingHandler.linkedReceipts = {};
                MatchingHandler.expenses = {};
                MatchingHandler.header.poToSearchForDetails = [];
                MatchingHandler.header.itemsToSearchForDetails = [];
                MatchingHandler.header.VBvendor = _integerFromRecordIDValue(newRecord,'entity')
                MatchingHandler.header.VBID = recordId
                MatchingHandler.header.VBlocation = _integerFromRecordIDValue(newRecord,'location')
                MatchingHandler.header.VBdepartment = _integerFromRecordIDValue(newRecord,'department')

                // handle base object, storing all info related to the current bill
                // in particular, really important the orderline field that it's matching the related PO
                var workingSublist = 'item';
                var linesCount = newRecord.getLineCount(workingSublist);
                var matchingStatus = null;
                var orderLine = null;
                for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){

                    orderLine = getLineValue(newRecord,iCountSublistLines,workingSublist,'orderline', convertToInteger);
                    matchingStatus = getLineValue(newRecord,iCountSublistLines,workingSublist,'custcol_h2gs_matching_status', convertToInteger);

                    if (!matchingStatus){
                        _setMatchingStatus(newRecord,iCountSublistLines,workingSublist,defaultMatchingStatus);
                        matchingStatus = defaultMatchingStatus;
                    }

                    if ((StatusesToContinueMatching.indexOf(matchingStatus) > -1)){
                        if (orderLine){
                            log.debug({
                                title: '_handleWFAction matchings ' + recordId,
                                details: 'orderLine: ' + orderLine + ' line ' + iCountSublistLines
                            });

                            if (typeof MatchingHandler.items[orderLine] == 'undefined'){
                                MatchingHandler.items[orderLine] = {};
                                MatchingHandler.items[orderLine].purchOrderLineId = orderLine;
                                MatchingHandler.items[orderLine].fullyReceived = false;
                                MatchingHandler.items[orderLine].fullyReceived_withTolerances = false;
                                MatchingHandler.items[orderLine].fullyMatched = false;
                                MatchingHandler.items[orderLine].fullyMatched_withTolerances = false;
                                MatchingHandler.items[orderLine].VBLineSequenceNumber = iCountSublistLines;

                                var orderId = getLineValue(newRecord,iCountSublistLines,workingSublist,'orderdoc', convertToInteger);
                            }

                            if (typeof MatchingHandler.linkedOrders[orderId] == 'undefined'){
                                MatchingHandler.linkedOrders[orderId] = true;
                                MatchingHandler.header.poToSearchForDetails.push(orderId)
                            }

                            MatchingHandler.items[orderLine].purchOrderId = orderId;
                            MatchingHandler.items[orderLine].matchingStatus = matchingStatus;
                            MatchingHandler.items[orderLine].fullyMatched = _getMatchingStatusFromMatchingId(FullyMatchingPoStatuses, MatchingHandler.items[orderLine].matchingStatus);
                            MatchingHandler.items[orderLine].fullyMatched_withTolerances = _getMatchingStatusFromMatchingId(ToleranceMatchingPoStatuses, MatchingHandler.items[orderLine].matchingStatus);
                            MatchingHandler.items[orderLine].fullyReceived = _getMatchingStatusFromMatchingId(FullyMatchingIRStatuses, MatchingHandler.items[orderLine].matchingStatus);
                            MatchingHandler.items[orderLine].fullyReceived_withTolerances = _getMatchingStatusFromMatchingId(ToleranceMatchingIRStatuses, MatchingHandler.items[orderLine].matchingStatus);
                            MatchingHandler.items[orderLine].VBitemId = getLineValue(newRecord,iCountSublistLines,workingSublist,'item', convertToInteger);
                            MatchingHandler.items[orderLine].VBitemName = getLineValue(newRecord,iCountSublistLines,workingSublist,'item_display');

                            if (typeof MatchingHandler.linkedItems[MatchingHandler.items[orderLine].VBitemId] == 'undefined'){
                                MatchingHandler.linkedItems[MatchingHandler.items[orderLine].VBitemId] = true;
                                MatchingHandler.header.itemsToSearchForDetails.push(MatchingHandler.items[orderLine].VBitemId)
                            }

                            MatchingHandler.items[orderLine].VBquantity = getLineValue(newRecord,iCountSublistLines,workingSublist,'quantity');
                            if (matchByGrossAmount){
                                MatchingHandler.items[orderLine].VBamountFX = getLineValue(newRecord,iCountSublistLines,workingSublist,'grossamt');
                            } else {
                                MatchingHandler.items[orderLine].VBamountFX = getLineValue(newRecord,iCountSublistLines,workingSublist,'amount');
                            }
                            MatchingHandler.items[orderLine].VBrateFX = getLineValue(newRecord,iCountSublistLines,workingSublist,'rate');
                        } else {
                            log.debug({
                                title: '_handleWFAction matchings '+ recordId,
                                details: 'No order ID, cannot be matched: ' + iCountSublistLines
                            });

                            _setMatchingStatus(newRecord,iCountSublistLines,workingSublist,defaultNotFoundStatus)
                        }
                    } else {
                        log.debug({
                            title: '_handleWFAction matchings '+ recordId,
                            details: 'This item line has already been matched: ' + iCountSublistLines + ' matchingStatus: ' + matchingStatus
                        });
                    }
                };

                // Handle expenses
                // all expenses will be validated with amount only
                workingSublist = 'expense';
                linesCount = newRecord.getLineCount(workingSublist);
                for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){

                    var orderLine = getLineValue(newRecord,iCountSublistLines,workingSublist,'orderline', convertToInteger);
                    matchingStatus = getLineValue(newRecord,iCountSublistLines,workingSublist,'custcol_h2gs_matching_status', convertToInteger);

                    if (!matchingStatus){
                        _setMatchingStatus(newRecord,iCountSublistLines,workingSublist,defaultMatchingStatus);
                        matchingStatus = defaultMatchingStatus;
                    }

                    if ((StatusesToContinueMatching.indexOf(matchingStatus) > -1)){
                        if (orderLine){
                            log.debug({
                                title: '_handleWFAction matchings '+ recordId,
                                details: 'orderLine: ' + orderLine + ' line ' + iCountSublistLines
                            });

                            if (typeof MatchingHandler.expenses[orderLine] == 'undefined'){
                                MatchingHandler.expenses[orderLine] = {};
                                MatchingHandler.expenses[orderLine].purchOrderLineId = orderLine;
                                MatchingHandler.expenses[orderLine].fullyReceived = true;
                                MatchingHandler.expenses[orderLine].fullyReceived_withTolerances = false;
                                MatchingHandler.expenses[orderLine].fullyMatched = false;
                                MatchingHandler.expenses[orderLine].fullyMatched_withTolerances = false;
                                MatchingHandler.expenses[orderLine].VBLineSequenceNumber = iCountSublistLines;
                            }

                            if (typeof MatchingHandler.linkedOrders[orderId] == 'undefined'){
                                MatchingHandler.linkedOrders[orderId] = true;
                                MatchingHandler.header.poToSearchForDetails.push(orderId)
                            }

                            MatchingHandler.expenses[orderLine].purchOrderId = getLineValue(newRecord,iCountSublistLines,workingSublist,'orderdoc', convertToInteger);
                            MatchingHandler.expenses[orderLine].matchingStatus = getLineValue(newRecord,iCountSublistLines,workingSublist,'custcol_h2gs_matching_status', convertToInteger);
                            MatchingHandler.expenses[orderLine].matchingStatus = matchingStatus;
                            MatchingHandler.expenses[orderLine].fullyMatched = _getMatchingStatusFromMatchingId(FullyMatchingPoStatuses, MatchingHandler.expenses[orderLine].matchingStatus);
                            MatchingHandler.expenses[orderLine].fullyMatched_withTolerances = _getMatchingStatusFromMatchingId(ToleranceMatchingPoStatuses, MatchingHandler.expenses[orderLine].matchingStatus);
                            MatchingHandler.expenses[orderLine].VBaccountId = getLineValue(newRecord,iCountSublistLines,workingSublist,'account', convertToInteger);
                            MatchingHandler.expenses[orderLine].VBaccountName = getLineValue(newRecord,iCountSublistLines,workingSublist,'account_display');

                            if (matchByGrossAmount){
                                MatchingHandler.expenses[orderLine].VBamountFX = getLineValue(newRecord,iCountSublistLines,workingSublist,'grossamt');
                            } else {
                                MatchingHandler.expenses[orderLine].VBamountFX = getLineValue(newRecord,iCountSublistLines,workingSublist,'amount');
                            }
                        } else {
                            _setMatchingStatus(newRecord,iCountSublistLines,workingSublist,defaultNotFoundStatus)
                        }
                    } else {
                        log.debug({
                            title: '_handleWFAction matchings '+ recordId,
                            details: 'This expense line has already been matched: ' + iCountSublistLines + ' matchingStatus: ' + matchingStatus
                        });
                    }
                };

                if (MatchingHandler.header.poToSearchForDetails.length > 0){
                    _appendToLog(newRecord,'Found ' + MatchingHandler.header.poToSearchForDetails.length + ' purchaser orders linked to this vendor bill' + ' purchase orders Id: ' + JSON.stringify(MatchingHandler.header.poToSearchForDetails));

                    if (MatchingHandler.header.poToSearchForDetails.length == 1){
                        var linkedPOid = MatchingHandler.header.poToSearchForDetails[0];

                        _appendToLog(newRecord,'Extracting related purchase orders and Item Receipts data for linked PO ID: ' + linkedPOid);

                        _getLinkedPosAndVBillsDetails(linkedPOid, MatchingHandler);

                        _appendToLog(newRecord,'Matches performed, updating the record');

                        var currentItemLine = null;
                        var workingSublist = 'item';
                        for (var itemSublistOrderLines in MatchingHandler.items){
                            currentItemLine = MatchingHandler.items[itemSublistOrderLines];

                            log.debug({
                                title: '_handleWFAction matchings '+ recordId,
                                details: 'ITEM Line: ' + itemSublistOrderLines
                            });

                            log.debug({
                                title: '_handleWFAction matchings '+ recordId,
                                details: 'currentItemLine: ' + JSON.stringify(currentItemLine)
                            });


                            if (currentItemLine.lineHasBeenFullyReceived && currentItemLine.lineHasBeenFullyInvoiced){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 4 PO Matched, IR Matched'
                                });

                                _setMatchingStatus(newRecord,currentItemLine.VBLineSequenceNumber,workingSublist,4) // 	PO Matched, IR Matched
                            } else if (currentItemLine.lineHasBeenFullyReceived && currentItemLine.lineHasBeenInvoicedWithinTolerance){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 5 PO Matched (tol), IR Matched'
                                });

                                _setMatchingStatus(newRecord,currentItemLine.VBLineSequenceNumber,workingSublist,5) // 	PO Matched (tol), IR Matched
                            } else if (currentItemLine.lineHasBeenReceivedWithinTolerance && currentItemLine.lineHasBeenFullyInvoiced){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 6 PO Matched, IR Matched (tol)'
                                });

                                _setMatchingStatus(newRecord,currentItemLine.VBLineSequenceNumber,workingSublist,6) // 	PO Matched, IR Matched (tol)
                            } else if (!currentItemLine.lineHasBeenFullyReceived && currentItemLine.lineHasBeenFullyInvoiced){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 2 PO Matched, IR not Matched'
                                });

                                _setMatchingStatus(newRecord,currentItemLine.VBLineSequenceNumber,workingSublist,2) // 	PO Matched, IR not Matched
                            } else if (!currentItemLine.lineHasBeenFullyReceived && currentItemLine.lineHasBeenInvoicedWithinTolerance){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 3 PO Matched (tol), IR not Matched'
                                });

                                _setMatchingStatus(newRecord,currentItemLine.VBLineSequenceNumber,workingSublist,3) // 	PO Matched (tol), IR not Matched
                            } else if (currentItemLine.lineHasBeenReceivedWithinTolerance && currentItemLine.lineHasBeenInvoicedWithinTolerance){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 7 PO Matched (tol), IR Matched (tol)'
                                });

                                _setMatchingStatus(newRecord,currentItemLine.VBLineSequenceNumber,workingSublist,7) // 	PO Matched (tol), IR Matched (tol)
                            }

                            // ELSE IT MEANS STATUS IS 1 or 8 and both are set before in case it's needed
                        }

                        var currentExpenseLine = null;
                        var workingSublist = 'expense';
                        for (var expenseSublistOrderLines in MatchingHandler.expenses){
                            currentExpenseLine = MatchingHandler.expenses[expenseSublistOrderLines];

                            log.debug({
                                title: '_handleWFAction matchings '+ recordId,
                                details: 'ITEM Line: ' + expenseSublistOrderLines
                            });

                            if (currentExpenseLine.lineHasBeenFullyReceived && currentExpenseLine.lineHasBeenFullyInvoiced){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 4 PO Matched, IR Matched'
                                });

                                _setMatchingStatus(newRecord,currentExpenseLine.VBLineSequenceNumber,workingSublist,4) // 	PO Matched, IR Matched
                            } else if (currentExpenseLine.lineHasBeenFullyReceived && currentExpenseLine.lineHasBeenInvoicedWithinTolerance){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 5 PO Matched (tol), IR Matched'
                                });

                                _setMatchingStatus(newRecord,currentExpenseLine.VBLineSequenceNumber,workingSublist,5) // 	PO Matched (tol), IR Matched
                            } else if (currentExpenseLine.lineHasBeenReceivedWithinTolerance && currentExpenseLine.lineHasBeenFullyInvoiced){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 6 PO Matched, IR Matched (tol)'
                                });

                                _setMatchingStatus(newRecord,currentExpenseLine.VBLineSequenceNumber,workingSublist,6) // 	PO Matched, IR Matched (tol)
                            } else if (!currentExpenseLine.lineHasBeenFullyReceived && currentExpenseLine.lineHasBeenFullyInvoiced){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 2 PO Matched, IR not Matched'
                                });

                                _setMatchingStatus(newRecord,currentExpenseLine.VBLineSequenceNumber,workingSublist,2) // 	PO Matched, Pending IR
                            } else if (!currentExpenseLine.lineHasBeenFullyReceived && currentExpenseLine.lineHasBeenInvoicedWithinTolerance){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 3 PO Matched (tol), IR not Matched'
                                });

                                _setMatchingStatus(newRecord,currentExpenseLine.VBLineSequenceNumber,workingSublist,3) // 	PO Matched (tol), Pending IR
                            } else if (currentExpenseLine.lineHasBeenReceivedWithinTolerance && currentExpenseLine.lineHasBeenInvoicedWithinTolerance){

                                log.debug({
                                    title: '_handleWFAction matchings '+ recordId,
                                    details: 'setting current matching status as 7 PO Matched (tol), IR Matched (tol)'
                                });

                                _setMatchingStatus(newRecord,currentExpenseLine.VBLineSequenceNumber,workingSublist,7) // 	PO Matched (tol), IR Matched (tol)
                            }

                            // ELSE IT MEANS STATUS IS 1 or 8 and both are set before in case it's needed
                        }

                    } else {
                        _appendToLog(newRecord,'MULTIPLE PURCHASE ORDERS FOUND, MATCHING NOT HANDLED')

                        log.error({
                            title: '_handleWFAction matchings',
                            details: 'MULTIPLE PURCHASE ORDERS FOUND, MATCHING NOT HANDLED'
                        });
                    }

                } else
                {

                    _appendToLog(newRecord,'NO LINES NEED TO BE MATCHED');
                    // TODO change this log, more details / smarter

                    log.error({
                        title: '_handleWFAction matchings',
                        details: 'ALL LINES ARE MATCHED OR THERE ARE NO PO LINKED TO THIS VENDOR BILL, INVALID STATUS / STAGE'
                    });
                }

                log.audit({
                    title: '_handleWFAction matchings',
                    details: 'MatchingHandler: ' + JSON.stringify(MatchingHandler)
                });

                _appendToLog(newRecord,GLB_MatchingLogs);

                // NOW THAT ALL THE MATCHES HAVE BEEN PERFORMED, CHECKING IF WE CAN AUTO APPROVE THE BILL
                var canBeApproved = true;
                var partiallyMatched = false;
                var nothingMatched = true;

                workingSublist = 'item';
                linesCount = newRecord.getLineCount(workingSublist);
                var definitiveMatchingStatus = null;
                var notApprovedLinesLog = '';
                for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){
                    definitiveMatchingStatus = getLineValue(newRecord,iCountSublistLines,workingSublist,'custcol_h2gs_matching_status', convertToInteger);

                    log.audit({
                        title: '_handleWFAction matchings',
                        details: 'Item Line ' + iCountSublistLines + ' definitive matching status ' + definitiveMatchingStatus
                    });

                    if (StatusesWeCanApproveTheBill.indexOf(definitiveMatchingStatus) == -1){
                        canBeApproved = false;

                        notApprovedLinesLog += '\nSTATUS: ' + MatchingStatusIdToNameMap[definitiveMatchingStatus] + ' for item line ' + (iCountSublistLines+1)

                        log.audit({
                            title: '_handleWFAction matchings',
                            details: 'CANT BE AUTO APPROVED'
                        });
                    } else {
                        partiallyMatched = true;
                        nothingMatched = false;
                    }
                }

                workingSublist = 'expense';
                linesCount = newRecord.getLineCount(workingSublist);
                for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){
                    definitiveMatchingStatus = getLineValue(newRecord,iCountSublistLines,workingSublist,'custcol_h2gs_matching_status', convertToInteger);

                    log.audit({
                        title: '_handleWFAction matchings',
                        details: 'Expense Line ' + iCountSublistLines + ' definitive matching status ' + definitiveMatchingStatus
                    });

                    if (StatusesWeCanApproveTheBill.indexOf(definitiveMatchingStatus) == -1){
                        canBeApproved = false;

                        notApprovedLinesLog += '\nNOT APPROVED STATUS: ' + MatchingStatusIdToNameMap[definitiveMatchingStatus] + ' for expense line ' + (iCountSublistLines+1)

                        log.audit({
                            title: '_handleWFAction matchings',
                            details: 'CANT BE AUTO APPROVED'
                        });
                    }else {
                        partiallyMatched = true;
                        nothingMatched = false;
                    }
                }

                log.audit({
                    title: '_handleWFAction matchings',
                    details: 'partiallyMatched: ' + partiallyMatched
                });

                log.audit({
                    title: '_handleWFAction matchings',
                    details: 'nothingMatched: ' + nothingMatched
                });

                log.audit({
                    title: '_handleWFAction matchings',
                    details: 'canBeApproved: ' + canBeApproved
                });

                if (canBeApproved){
                    log.audit({
                        title: '_handleWFAction matchings',
                        details: 'The vendor bill will be automatically approved'
                    });

                    _appendToLog(newRecord,'The vendor bill will be automatically approved');

                    newRecord.setValue('custbody_h2gs_af_approval_stage', 13); // Matched (auto approved)

                } else {
                    if (partiallyMatched){
                        newRecord.setValue('custbody_h2gs_af_approval_stage', 12);  //Partially Matched / pending approval
                        _appendToLog(newRecord,'The vendor bill is partially matched and cannot be automatically approved' + notApprovedLinesLog);
                    } else {
                        _appendToLog(newRecord,'The vendor bill cannot be automatically approved' + notApprovedLinesLog);
                    }
                }

            } else {
                _appendToLog(newRecord,'No purchase orders linked to the vendor bill, will be automatically approved');
                newRecord.setValue('custbody_h2gs_af_approval_stage', 13); // Matched (auto approved)
            }


        }

    }

    function _getMatchingStatusFromMatchingId(matchingStatuses, matchingStatusId){
        return (matchingStatuses.indexOf(matchingStatusId) > -1)
    }

    function _getmapOfPOLineIds_FXAmounts(linkedPOid){

        var poRecord = recordModule.load({
            type: recordModule.Type.PURCHASE_ORDER,
            id: linkedPOid,
            isDynamic: true
        });

        var mapOfPOLineIds_FXAmounts = {};

        mapOfPOLineIds_FXAmounts.items = {};
        mapOfPOLineIds_FXAmounts.expenses = {};

        var workingSublist = 'item';
        var linesCount = poRecord.getLineCount(workingSublist);
        var poLineId = null;
        var AmountFX = null;
        for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){

            poLineId = getLineValue(poRecord,iCountSublistLines,workingSublist,'line', convertToInteger);
            AmountFX = Math.round(parseFloat(getLineValue(poRecord,iCountSublistLines,workingSublist,'grossamt'))*100)/100

            mapOfPOLineIds_FXAmounts.items[poLineId] = AmountFX
        }

        workingSublist = 'expense';
        linesCount = poRecord.getLineCount(workingSublist);
        poLineId = null;
        AmountFX = null;
        for (var iCountSublistLines = 0; iCountSublistLines < linesCount; iCountSublistLines++){

            poLineId = getLineValue(poRecord,iCountSublistLines,workingSublist,'line', convertToInteger);
            AmountFX = Math.round(parseFloat(getLineValue(poRecord,iCountSublistLines,workingSublist,'grossamt'))*100)/100

            mapOfPOLineIds_FXAmounts.expenses[poLineId] = AmountFX
        }

        return mapOfPOLineIds_FXAmounts
    }

    function roundToFloat2Decimal(toRoundValue){

/*        log.debug({
            title: '_handleWFAction roundToFloat2Decimal',
            details: 'toRoundValue: ' +toRoundValue
        });*/

        if (toRoundValue){

/*            log.debug({
                title: '_handleWFAction roundToFloat2Decimal',
                details: 'isNaN(parseFloat(toRoundValue)): ' +isNaN(parseFloat(toRoundValue))
            });*/

            if (!isNaN(parseFloat(toRoundValue))){

                var returnValue = Math.round(parseFloat(toRoundValue)*100)/100

/*                log.debug({
                    title: '_handleWFAction roundToFloat2Decimal',
                    details: 'returnValue: ' +returnValue
                });*/

                return Math.round(parseFloat(toRoundValue)*100)/100
            } else {
                return 0
            }
        } else {
            return 0
        }

    }

    function _getLinkedPosAndVBillsDetails(linkedPOid, MatchingHandler){

        var mapOfPOLineIds_FXAmounts = _getmapOfPOLineIds_FXAmounts(linkedPOid);

        log.audit({
            title: '_handleWFAction matchings',
            details: 'mapOfPOLineIds_FXAmounts: ' + JSON.stringify(mapOfPOLineIds_FXAmounts)
        });

        var transactionSearchObj = searchModule.create({
            type: "transaction",
            filters:
                [
                    ["internalid","anyof",linkedPOid],
                    "AND",
                    ["taxline","is","F"],
                    "AND",
                    ["mainline","is","F"]
                ],
            columns:
                [
                    searchModule.createColumn({name: "internalid", label: "Internal ID"}),
                    searchModule.createColumn({name: "trandate", label: "Date"}),
                    searchModule.createColumn({name: "tranid", label: "Document Number"}),
                    searchModule.createColumn({name: "linesequencenumber", label: "Line Seq Numb"}),
                    searchModule.createColumn({name: "line", label: "Line ID"}),
                    searchModule.createColumn({name: "account", label: "Account"}),
                    searchModule.createColumn({name: "item", label: "Item"}),
                    searchModule.createColumn({name: "isfulfillable", join: "item", label: "Can be Fulfilled"}),
                    searchModule.createColumn({name: "isfulfillable", join: "item", label: "Can be Fulfilled"}),
                    searchModule.createColumn({name: "isfulfillable", join: "item", label: "Can be Fulfilled"}),
                    searchModule.createColumn({name: "isfulfillable", join: "item", label: "Can be Fulfilled"}),
                    searchModule.createColumn({name: "quantity", label: "Quantity"}),
                    searchModule.createColumn({name: "quantityshiprecv", label: "Quantity Fulfilled/Received"}),
                    searchModule.createColumn({name: "quantitybilled", label: "Quantity Billed"}),
                    searchModule.createColumn({name: "amount", label: "Amount"}),
                    searchModule.createColumn({name: "fxamount", label: "Amount (Foreign Currency)"}),
                    searchModule.createColumn({name: "shiprecvstatusline", label: "Fulfilled/Received (Line Level)"}),
                    searchModule.createColumn({
                        name: "tranid",
                        join: "fulfillingTransaction",
                        label: "Document Number"
                    }),
                    searchModule.createColumn({
                        name: "internalid",
                        join: "fulfillingTransaction",
                        label: "Internal ID"
                    }),
                    searchModule.createColumn({
                        name: "type",
                        join: "fulfillingTransaction",
                        label: "Type"
                    }),
                    searchModule.createColumn({
                        name: "line",
                        join: "fulfillingTransaction",
                        label: "Line ID"
                    }),
                    searchModule.createColumn({
                        name: "linesequencenumber",
                        join: "fulfillingTransaction",
                        label: "Line Sequence Number"
                    }),
                    searchModule.createColumn({
                        name: "tranid",
                        join: "billingTransaction",
                        label: "Document Number"
                    }),
                    searchModule.createColumn({
                        name: "internalid",
                        join: "billingTransaction",
                        label: "Internal ID"
                    }),
                    searchModule.createColumn({
                        name: "type",
                        join: "billingTransaction",
                        label: "Type"
                    }),
                    searchModule.createColumn({
                        name: "line",
                        join: "billingTransaction",
                        label: "Line ID"
                    }),
                    searchModule.createColumn({
                        name: "linesequencenumber",
                        join: "billingTransaction",
                        label: "Line Sequence Number"
                    }),
                    searchModule.createColumn({
                        name: "receiptquantitydiff",
                        join: "item",
                        label: "Vendor Bill - Item Receipt Quantity Difference"
                    }),
                    searchModule.createColumn({
                        name: "receiptquantity",
                        join: "item",
                        label: "Vendor Bill - Item Receipt Quantity Tolerance"
                    }),
                    searchModule.createColumn({
                        name: "purchaseorderamount",
                        join: "item",
                        label: "Vendor Bill - Purchase Order Amount Tolerance"
                    }),
                    searchModule.createColumn({
                        name: "purchaseorderquantitydiff",
                        join: "item",
                        label: "Vendor Bill - Purchase Order Quantity Difference"
                    }),
                    searchModule.createColumn({
                        name: "purchaseorderquantity",
                        join: "item",
                        label: "Vendor Bill - Purchase Order Quantity Tolerance"
                    }),
                    searchModule.createColumn({
                        name: "receiptquantitydiff",
                        join: "vendor",
                        label: "Vendor Bill - Item Receipt Quantity Difference"
                    }),
                    searchModule.createColumn({
                        name: "receiptquantity",
                        join: "vendor",
                        label: "Vendor Bill - Item Receipt Quantity Tolerance"
                    }),
                    searchModule.createColumn({
                        name: "purchaseorderamount",
                        join: "vendor",
                        label: "Vendor Bill - Purchase Order Amount Tolerance"
                    }),
                    searchModule.createColumn({
                        name: "purchaseorderquantitydiff",
                        join: "vendor",
                        label: "Vendor Bill - Purchase Order Quantity Difference"
                    }),
                    searchModule.createColumn({
                        name: "purchaseorderquantity",
                        join: "vendor",
                        label: "Vendor Bill - Purchase Order Quantity Tolerance"
                    })
                ],
                settings: [{
                    name: 'consolidationtype',
                    value: 'NONE'
                }]
        });
        var searchResultCount = transactionSearchObj.runPaged().count;

        log.debug("transactionSearchObj result count",searchResultCount);

        var poDataHandler = {};
        transactionSearchObj.run().each(function(result){

            var purchOrderId = _integerFromRecordIDValue(result, 'internalid')
            var purchOrderLinesequencenumber = _integerFromRecordIDValue(result, 'linesequencenumber')

            log.audit({
                title: '_handleWFAction matchings',
                details: '--------------- PROCESSING RESULT, ORDER ID: ' + purchOrderId + ' order line sequence number ' + purchOrderLinesequencenumber
            });

            if (typeof poDataHandler[purchOrderId] == 'undefined'){
                poDataHandler[purchOrderId] = {};
                poDataHandler[purchOrderId].lines = {};
            }

            if (typeof poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber] == 'undefined'){
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber] = {};
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].fxamount = 0;


                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].quantity = _integerFromRecordIDValue(result, 'quantity');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].quantitybilled = _integerFromRecordIDValue(result, 'quantitybilled');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].quantityreceived = _integerFromRecordIDValue(result, 'quantityshiprecv');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].item = _integerFromRecordIDValue(result, 'item');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].account = _integerFromRecordIDValue(result, 'account');

                log.audit({
                    title: '_handleWFAction matchings',
                    details: '--- ITEM: ' + poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].item + ' ACCOUNT: ' + poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].account
                });

                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].POLineSequenceNumber = _integerFromRecordIDValue(result, 'linesequencenumber');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].POLineID = _integerFromRecordIDValue(result, 'line');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].itemName = result.getText('item')
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].purchOrderDocNumber = result.getValue('tranid')


                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VBlineSequenceNumber = _integerFromRecordIDValue_Join(result, 'linesequencenumber', 'billingTransaction');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VBId = _integerFromRecordIDValue_Join(result, 'internalid', 'billingTransaction');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VBtranid = result.getValue({
                    name: 'tranid',
                    join: 'billingTransaction'
                });
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].IRlineSequenceNumber = _integerFromRecordIDValue_Join(result, 'linesequencenumber', 'fulfillingTransaction');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].IRId = _integerFromRecordIDValue_Join(result, 'internalid', 'fulfillingTransaction');
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].IRtranid = result.getValue({
                    name: 'tranid',
                    join: 'fulfillingTransaction'
                });
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].ItemIsFulfillable = result.getValue({
                    name: 'isfulfillable',
                    join: 'item'
                });
                // ITEM 3WAY MATCH CONFIG
                var item_receiptquantitydiff = result.getValue({
                    name: 'receiptquantitydiff',
                    join: 'item'
                });
                var item_receiptquantity = result.getValue({
                    name: 'receiptquantity',
                    join: 'item'
                });
                var item_purchaseorderamount = result.getValue({
                    name: 'purchaseorderamount',
                    join: 'item'
                });
                var item_purchaseorderquantitydiff = result.getValue({
                    name: 'purchaseorderquantitydiff',
                    join: 'item'
                });
                var item_purchaseorderquantity = result.getValue({
                    name: 'purchaseorderquantity',
                    join: 'item'
                });
                // VENDOR 3 WAY MATCH CONFIG
                var vendor_receiptquantitydiff = result.getValue({
                    name: 'receiptquantitydiff',
                    join: 'vendor'
                });
                var vendor_receiptquantity = result.getValue({
                    name: 'receiptquantity',
                    join: 'vendor'
                });
                var vendor_purchaseorderamount = result.getValue({
                    name: 'purchaseorderamount',
                    join: 'vendor'
                });
                var vendor_purchaseorderquantitydiff = result.getValue({
                    name: 'purchaseorderquantitydiff',
                    join: 'vendor'
                });
                var vendor_purchaseorderquantity = result.getValue({
                    name: 'purchaseorderquantity',
                    join: 'vendor'
                });

                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_IR_QTY_DIF = 0; // Vendor Bill - Item Receipt Quantity Difference
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_IR_QTY_TOL = 0; // Vendor Bill - Item Receipt Quantity Tolerance
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_AMT_TOL = 0; // Vendor Bill - Purchase Order Amount Tolerance
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_QTY_DIF = 0; // Vendor Bill - Purchase Order Quantity Difference
                poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_QTY_TOL = 0; // Vendor Bill - Purchase Order Quantity Tolerance

                log.debug({
                    title: '_handleWFAction matchings',
                    details: 'item_receiptquantitydiff: ' + item_receiptquantitydiff + ' vendor_receiptquantitydiff: ' + vendor_receiptquantitydiff
                });

                log.debug({
                    title: '_handleWFAction matchings',
                    details: 'item_receiptquantity: ' + item_receiptquantity + ' vendor_receiptquantity: ' + vendor_receiptquantity
                });

                log.debug({
                    title: '_handleWFAction matchings',
                    details: 'item_purchaseorderamount: ' + item_purchaseorderamount + ' vendor_purchaseorderquantitydiff: ' + vendor_purchaseorderquantitydiff
                });

                log.debug({
                    title: '_handleWFAction matchings',
                    details: 'item_purchaseorderquantitydiff: ' + item_purchaseorderquantitydiff + ' vendor_purchaseorderquantitydiff: ' + vendor_purchaseorderquantitydiff
                });

                log.debug({
                    title: '_handleWFAction matchings',
                    details: 'item_purchaseorderquantity: ' + item_purchaseorderquantity + ' vendor_purchaseorderquantity: ' + vendor_purchaseorderquantity
                });

                //receiptquantitydiff

                if (item_receiptquantitydiff){
                    poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_IR_QTY_DIF = roundToFloat2Decimal(item_receiptquantitydiff);
                } else {
                    if (vendor_receiptquantitydiff){
                        poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_IR_QTY_DIF = roundToFloat2Decimal(vendor_receiptquantitydiff);
                    }
                }

                if (item_receiptquantity){
                    poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_IR_QTY_TOL = roundToFloat2Decimal(item_receiptquantity);
                } else {
                    if (vendor_receiptquantity){
                        poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_IR_QTY_TOL = roundToFloat2Decimal(vendor_receiptquantity);
                    }
                }

                if (item_purchaseorderamount){
                    poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_AMT_TOL = roundToFloat2Decimal(item_purchaseorderamount);
                } else {
                    if (vendor_purchaseorderamount){
                        poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_AMT_TOL = roundToFloat2Decimal(vendor_purchaseorderamount);
                    }
                }

                if (item_purchaseorderquantitydiff){
                    poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_QTY_DIF = roundToFloat2Decimal(item_purchaseorderquantitydiff);
                } else {
                    if (vendor_purchaseorderquantitydiff){
                        poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_QTY_DIF = roundToFloat2Decimal(vendor_purchaseorderquantitydiff);
                    }
                }

                if (item_purchaseorderquantity){
                    poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_QTY_TOL = roundToFloat2Decimal(item_purchaseorderquantity);
                } else {
                    if (vendor_purchaseorderquantity){
                        poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber].VB_PO_QTY_TOL = roundToFloat2Decimal(vendor_purchaseorderquantity);
                    }
                }

                var currentLine = poDataHandler[purchOrderId].lines[purchOrderLinesequencenumber];
                var POLineSequenceNumber = currentLine.POLineID; // TODO refactor to line ID and not sequence number in the variable name
                var accountId = currentLine.account;

                if (MatchingHandler.header.VBID == currentLine.VBId){
                    // if this is one of the order lines related to saving VB

                    if (currentLine.item){

                        if (typeof MatchingHandler.items[POLineSequenceNumber] != 'undefined'){
                            // IF this order line it's related to the saving VB

                            log.audit({
                                title: '_handleWFAction matchings',
                                details: 'MATCHING ITEM: MatchingHandler.header.VBID: ' + MatchingHandler.header.VBID + ' MatchingHandler.items[POLineSequenceNumber].VBitemId: ' + MatchingHandler.items[POLineSequenceNumber].VBitemId + ' currentLine.VBId: ' + currentLine.VBId + ' currentLine.item' + currentLine.item
                            });

                            if (currentLine.item == MatchingHandler.items[POLineSequenceNumber].VBitemId){

                                log.audit({
                                    title: '_handleWFAction matchings',
                                    details: '+++ MATCHED ITEM SUBLIST VB LINE'
                                });

                                MatchingHandler.items[POLineSequenceNumber].VB_IR_QTY_DIF = currentLine.VB_IR_QTY_DIF
                                MatchingHandler.items[POLineSequenceNumber].VB_IR_QTY_TOL= currentLine.VB_IR_QTY_TOL
                                MatchingHandler.items[POLineSequenceNumber].VB_PO_AMT_TOL = currentLine.VB_PO_AMT_TOL
                                MatchingHandler.items[POLineSequenceNumber].VB_PO_QTY_DIF = currentLine.VB_PO_QTY_DIF
                                MatchingHandler.items[POLineSequenceNumber].VB_PO_QTY_TOL = currentLine.VB_PO_QTY_TOL

                                MatchingHandler.items[POLineSequenceNumber].POquantity = currentLine.quantity
                                MatchingHandler.items[POLineSequenceNumber].POquantitybilled= currentLine.quantitybilled
                                MatchingHandler.items[POLineSequenceNumber].POquantityreceived = currentLine.quantityreceived
                                MatchingHandler.items[POLineSequenceNumber].POamountFX = 0;

                                if (typeof mapOfPOLineIds_FXAmounts.items[POLineSequenceNumber] != 'undefined'){
                                    log.audit({
                                        title: '_handleWFAction matchings',
                                        details: 'OVERRIDING FX AMOUNT'
                                    });

                                    MatchingHandler.items[POLineSequenceNumber].POamountFX = mapOfPOLineIds_FXAmounts.items[POLineSequenceNumber]
                                }

                                MatchingHandler.items[POLineSequenceNumber].lineHasBeenFullyReceived = false;
                                MatchingHandler.items[POLineSequenceNumber].lineHasBeenFullyInvoiced = false;
                                MatchingHandler.items[POLineSequenceNumber].lineHasBeenReceivedWithinTolerance = false;
                                MatchingHandler.items[POLineSequenceNumber].lineHasBeenInvoicedWithinTolerance = false;

                                var MatchedPOLine = MatchingHandler.items[POLineSequenceNumber];

                                GLB_MatchingLogs += '\n\nMatching VB item line ' + MatchedPOLine.VBLineSequenceNumber + ' ITEM ' + MatchedPOLine.VBitemName

                                if (!currentLine.ItemIsFulfillable){
                                    GLB_MatchingLogs += '\nPO Amount ' +MatchedPOLine.POamountFX + ' VB Amount ' + MatchedPOLine.VBamountFX
                                    GLB_MatchingLogs += '\nPO QTY ' + MatchedPOLine.POquantity + ' VB QTY ' + MatchedPOLine.VBquantity

                                    _handleMatchStatusComparingVBandPOFXAmountAndQuantity(MatchedPOLine);
                                } else {
                                    GLB_MatchingLogs += '\nPO Amount ' +MatchedPOLine.POamountFX + ' VB Amount ' + MatchedPOLine.VBamountFX
                                    GLB_MatchingLogs += '\nPO QTY ' + MatchedPOLine.POquantity + ' VB QTY ' + MatchedPOLine.VBquantity + ' IR QTY ' + MatchedPOLine.POquantityreceived

                                    _handleMatchStatusComparingVB_PO_IR(MatchedPOLine);
                                }
                            }

                        };
                    } else {
                        if (currentLine.account){


                            // if this is one of the order lines related to saving VB
                            if (typeof MatchingHandler.expenses[POLineSequenceNumber] != 'undefined'){
                                log.audit({
                                    title: '_handleWFAction matchings',
                                    details: 'MATCHING EXPENSE MatchingHandler.header.VBID: ' + MatchingHandler.header.VBID + ' MatchingHandler.items[POLineSequenceNumber].VBaccountId: ' + MatchingHandler.expenses[POLineSequenceNumber].VBaccountId + ' currentLine.VBaccountId: ' + currentLine.VBId + ' currentLine.account' + currentLine.account
                                });

                                if (currentLine.account == MatchingHandler.expenses[POLineSequenceNumber].VBaccountId){

                                    log.audit({
                                        title: '_handleWFAction matchings',
                                        details: '+++ MATCHED EXPENSES SUBLIST VB LINE'
                                    });

                                    MatchingHandler.expenses[POLineSequenceNumber].VB_IR_QTY_DIF = currentLine.VB_IR_QTY_DIF
                                    MatchingHandler.expenses[POLineSequenceNumber].VB_IR_QTY_TOL= currentLine.VB_IR_QTY_TOL
                                    MatchingHandler.expenses[POLineSequenceNumber].VB_PO_AMT_TOL = currentLine.VB_PO_AMT_TOL
                                    MatchingHandler.expenses[POLineSequenceNumber].VB_PO_QTY_DIF = currentLine.VB_PO_QTY_DIF
                                    MatchingHandler.expenses[POLineSequenceNumber].VB_PO_QTY_TOL = currentLine.VB_PO_QTY_TOL

                                    MatchingHandler.expenses[POLineSequenceNumber].POquantity = currentLine.quantity
                                    MatchingHandler.expenses[POLineSequenceNumber].POquantitybilled= currentLine.quantitybilled
                                    MatchingHandler.expenses[POLineSequenceNumber].POquantityreceived = currentLine.quantityreceived
                                    MatchingHandler.expenses[POLineSequenceNumber].POamountFX = 0;

                                    if (typeof mapOfPOLineIds_FXAmounts.expenses[POLineSequenceNumber] != 'undefined'){
                                        log.audit({
                                            title: '_handleWFAction matchings',
                                            details: 'OVERRIDING FX AMOUNT'
                                        });

                                        MatchingHandler.expenses[POLineSequenceNumber].POamountFX = mapOfPOLineIds_FXAmounts.expenses[POLineSequenceNumber]
                                    }
                                    MatchingHandler.expenses[POLineSequenceNumber].lineHasBeenFullyReceived = false;
                                    MatchingHandler.expenses[POLineSequenceNumber].lineHasBeenFullyInvoiced = false;
                                    MatchingHandler.expenses[POLineSequenceNumber].lineHasBeenReceivedWithinTolerance = false;
                                    MatchingHandler.expenses[POLineSequenceNumber].lineHasBeenInvoicedWithinTolerance = false;

                                    var MatchedPOLine = MatchingHandler.expenses[POLineSequenceNumber];

                                    GLB_MatchingLogs += '\n\nMatching VB expense line ' + MatchedPOLine.VBLineSequenceNumber + ' ACCOUNT ' + MatchedPOLine.VBaccountName
                                    GLB_MatchingLogs += '\nPO Amount ' +MatchedPOLine.POamountFX + ' VB Amount ' + MatchedPOLine.VBamountFX

                                    if (!currentLine.ItemIsFulfillable){
                                        _handleMatchStatusComparingVBAndPOFXAmountOnly(MatchingHandler.expenses[POLineSequenceNumber]);
                                    } else {
                                        // right now cant see any case where an expense line not fulfillable (all) should be matched by something additional to total line FX amount
                                        _handleMatchStatusComparingVBAndPOFXAmountOnly(MatchingHandler.expenses[POLineSequenceNumber]);
                                    }
                                } else {
                                    log.debug({
                                        title: '_handleWFAction matchings',
                                        details: '--- NO MATCH, DIFFERENT ACCOUNT'
                                    });
                                }

                            };
                        } else {
                            log.debug({
                                title: '_handleWFAction matchings',
                                details: '--- NO MATCH, CURRENT LINE ITS NOT HAVING ANY ACCOUNT OR AN ITEM TO MATCH'
                            });
                        }
                    }
                } else {
                    log.debug({
                        title: '_handleWFAction matchings',
                        details: '--- NO MATCH, DIFFERENT VB'
                    });
                }


            }


            return true;
        });

        return poDataHandler;
    }

    function _handleMatchStatusComparingVBAndPOFXAmountOnly(MatchedPOLine){

        MatchedPOLine.lineHasBeenFullyInvoiced = false;
        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;

        if (MatchedPOLine.POamountFX === MatchedPOLine.VBamountFX){
            MatchedPOLine.lineHasBeenFullyInvoiced = true
            GLB_MatchingLogs += '\nPO AND VB AMOUNT MATCH'
        } else {
            GLB_MatchingLogs += '\nPO AND VB AMOUNT NOT MATCH: APPLYING AMOUNT % TOLERANCE LEVELS'
            if (MatchedPOLine.VB_PO_AMT_TOL > 0){
                GLB_MatchingLogs += '\nAPPLYING A TOLERANCE LEVEL FOR VB AMOUNT OF ' + MatchedPOLine.VB_PO_AMT_TOL + '%';
                MatchedPOLine.VBamountFX_MAX_WithTolerance = MatchedPOLine.VBamountFX + (MatchedPOLine.VBamountFX / 100 * MatchedPOLine.VB_PO_AMT_TOL)
                MatchedPOLine.VBamountFX_MIN_WithTolerance = MatchedPOLine.VBamountFX - (MatchedPOLine.VBamountFX / 100 * MatchedPOLine.VB_PO_AMT_TOL)

                GLB_MatchingLogs += '\nAccepted VB amount MIN ' + MatchedPOLine.VBamountFX_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBamountFX_MAX_WithTolerance;

                if ((MatchedPOLine.POamountFX >= MatchedPOLine.VBamountFX_MIN_WithTolerance) && (MatchedPOLine.POamountFX <= MatchedPOLine.VBamountFX_MAX_WithTolerance)){
                    GLB_MatchingLogs += '\nPO AND VB AMOUNT MATCH WITH TOLERANCE LEVELS'
                    MatchedPOLine.lineHasBeenInvoicedWithinTolerance = true;
                } else {
                    MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                    GLB_MatchingLogs += '\nPO AND VB AMOUNT NOT MATCH WITH TOLERANCE LEVELS'
                }
            } else {
                MatchedPOLine.lineHasBeenFullyInvoiced = false;
                MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                GLB_MatchingLogs += '\nTOLERANCE LEVELS NOT DEFINED IN THE VENDOR AND IN THE ITEM, NOT MATCHED'
            }
        }

        GLB_MatchingLogs += '\nTHIS LINE NOT REQUIRE AN IR MATCHING'
        MatchedPOLine.lineHasBeenFullyReceived = true
        MatchedPOLine.lineHasBeenReceivedWithinTolerance = false

    }

    function _handleMatchStatusComparingVB_PO_IR(MatchedPOLine){

        MatchedPOLine.lineHasBeenFullyInvoiced = false
        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false
        MatchedPOLine.lineHasBeenFullyReceived = false;
        MatchedPOLine.lineHasBeenReceivedWithinTolerance = false;

        if (MatchedPOLine.POamountFX === MatchedPOLine.VBamountFX){
            MatchedPOLine.lineHasBeenFullyInvoiced = true
            GLB_MatchingLogs += '\nPO AND VB AMOUNT MATCH'
        } else {
            GLB_MatchingLogs += '\nPO AND VB AMOUNT NOT MATCH: APPLYING AMOUNT % TOLERANCE LEVELS'
            if (MatchedPOLine.VB_PO_AMT_TOL > 0){
                GLB_MatchingLogs += '\nAPPLYING A TOLERANCE LEVEL FOR VB AMOUNT OF ' + MatchedPOLine.VB_PO_AMT_TOL + '%';
                MatchedPOLine.VBamountFX_MAX_WithTolerance = MatchedPOLine.VBamountFX + (MatchedPOLine.VBamountFX / 100 * MatchedPOLine.VB_PO_AMT_TOL)
                MatchedPOLine.VBamountFX_MIN_WithTolerance = MatchedPOLine.VBamountFX - (MatchedPOLine.VBamountFX / 100 * MatchedPOLine.VB_PO_AMT_TOL)

                GLB_MatchingLogs += '\nAccepted VB amount MIN ' + MatchedPOLine.VBamountFX_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBamountFX_MAX_WithTolerance;

                if ((MatchedPOLine.POamountFX >= MatchedPOLine.VBamountFX_MIN_WithTolerance) && (MatchedPOLine.POamountFX <= MatchedPOLine.VBamountFX_MAX_WithTolerance)){
                    GLB_MatchingLogs += '\nPO AND VB AMOUNT MATCH WITH TOLERANCE LEVELS'
                    MatchedPOLine.lineHasBeenInvoicedWithinTolerance = true;
                } else {
                    MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                    GLB_MatchingLogs += '\nPO AND VB AMOUNT NOT MATCH WITH TOLERANCE LEVELS'
                }
            } else {
                MatchedPOLine.lineHasBeenFullyInvoiced = false;
                MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                GLB_MatchingLogs += '\nTOLERANCE LEVELS NOT DEFINED IN THE VENDOR AND IN THE ITEM, NOT MATCHED'
            }
        }

        if (MatchedPOLine.lineHasBeenFullyInvoiced || MatchedPOLine.lineHasBeenInvoicedWithinTolerance){
            if (MatchedPOLine.POquantity === MatchedPOLine.VBquantity){
                GLB_MatchingLogs += '\nPO AND VB QUANTITY MATCH'
            } else {
                MatchedPOLine.lineHasBeenFullyInvoiced = false
                GLB_MatchingLogs += '\nPO AND VB QUANTITY NOT MATCH: APPLYING QUANTITY % TOLERANCE LEVEL'

                if (MatchedPOLine.VB_PO_QTY_TOL > 0){
                    GLB_MatchingLogs += '\nAPPLYING A TOLERANCE LEVEL FOR VB QUANTITY OF ' + MatchedPOLine.VB_PO_QTY_TOL + '%';
                    MatchedPOLine.VBquantity_MAX_WithTolerance = MatchedPOLine.VBquantity + (MatchedPOLine.VBquantity / 100 * MatchedPOLine.VB_PO_QTY_TOL)
                    MatchedPOLine.VBquantity_MIN_WithTolerance = MatchedPOLine.VBquantity - (MatchedPOLine.VBquantity / 100 * MatchedPOLine.VB_PO_QTY_TOL)

                    GLB_MatchingLogs += '\nAccepted VB quantity MIN' + MatchedPOLine.VBquantity_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBquantity_MAX_WithTolerance;

                    if ((MatchedPOLine.POquantity >= MatchedPOLine.VBquantity_MIN_WithTolerance) && (MatchedPOLine.POquantity <= MatchedPOLine.VBquantity_MAX_WithTolerance)){
                        GLB_MatchingLogs += '\nPO AND VB QUANTITY MATCH WITH THIS TOLERANCE LEVEL'
                        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = true;
                    } else {
                        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                        GLB_MatchingLogs += '\nPO AND VB QUANTITY NOT MATCH WITH THIS TOLERANCE LEVEL'
                    }
                } else {

                    if (MatchedPOLine.VB_PO_QTY_DIF > 0){
                        GLB_MatchingLogs += '\nAPPLYING A FIXED TOLERANCE LEVEL FOR VB QUANTITY OF ' + MatchedPOLine.VB_PO_QTY_DIF ;
                        MatchedPOLine.VBquantity_MAX_WithTolerance = MatchedPOLine.VBquantity + MatchedPOLine.VB_PO_QTY_DIF
                        MatchedPOLine.VBquantity_MIN_WithTolerance = MatchedPOLine.VBquantity - MatchedPOLine.VB_PO_QTY_DIF

                        GLB_MatchingLogs += '\nAccepted VB quantity MIN' + MatchedPOLine.VBquantity_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBquantity_MAX_WithTolerance;

                        if ((MatchedPOLine.POquantity >= MatchedPOLine.VBquantity_MIN_WithTolerance) && (MatchedPOLine.POquantity <= MatchedPOLine.VBquantity_MAX_WithTolerance)){
                            GLB_MatchingLogs += '\nPO AND VB QUANTITY MATCH WITH THIS TOLERANCE LEVEL'
                            MatchedPOLine.lineHasBeenInvoicedWithinTolerance = true;
                        } else {
                            MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                            GLB_MatchingLogs += '\nPO AND VB QUANTITY NOT MATCH WITH THIS TOLERANCE LEVEL'
                        }
                    } else {
                        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                        GLB_MatchingLogs += '\nTOLERANCE LEVELS NOT DEFINED IN THE VENDOR AND IN THE ITEM, NOT MATCHED'
                    }
                }
            }
        }

        if (MatchedPOLine.VBquantity === MatchedPOLine.POquantityreceived){
            MatchedPOLine.lineHasBeenFullyReceived = true
            MatchedPOLine.lineHasBeenReceivedWithinTolerance = false

            GLB_MatchingLogs += '\nVB AND IR QUANTITY MATCH'
        } else {
            MatchedPOLine.lineHasBeenFullyReceived = false
            GLB_MatchingLogs += '\nVB AND IR QUANTITY NOT MATCH: APPLYING QUANTITY % TOLERANCE LEVEL'

            if (MatchedPOLine.VB_IR_QTY_TOL > 0){
                GLB_MatchingLogs += '\nAPPLYING A TOLERANCE LEVEL FOR VB QUANTITY OF ' + MatchedPOLine.VB_IR_QTY_TOL + '%';
                MatchedPOLine.VBquantity_MAX_WithTolerance = MatchedPOLine.VBquantity + (MatchedPOLine.VBquantity / 100 * MatchedPOLine.VB_IR_QTY_TOL)
                MatchedPOLine.VBquantity_MIN_WithTolerance = MatchedPOLine.VBquantity - (MatchedPOLine.VBquantity / 100 * MatchedPOLine.VB_IR_QTY_TOL)

                GLB_MatchingLogs += '\nAccepted VB quantity MIN' + MatchedPOLine.VBquantity_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBquantity_MAX_WithTolerance;

                if ((MatchedPOLine.POquantityreceived >= MatchedPOLine.VBquantity_MIN_WithTolerance) && (MatchedPOLine.POquantityreceived <= MatchedPOLine.VBquantity_MAX_WithTolerance)){
                    GLB_MatchingLogs += '\nIR AND VB QUANTITY MATCH WITH % TOLERANCE LEVEL'
                    MatchedPOLine.lineHasBeenReceivedWithinTolerance = true;
                } else {
                    MatchedPOLine.lineHasBeenReceivedWithinTolerance = false;
                    GLB_MatchingLogs += '\nIR AND VB QUANTITY NOT MATCH WITH THIS TOLERANCE LEVEL'
                }
            } else {

                if (MatchedPOLine.VB_IR_QTY_DIF > 0){
                    GLB_MatchingLogs += '\nAPPLYING A FIXED TOLERANCE LEVEL FOR VB QUANTITY OF ' + MatchedPOLine.VB_IR_QTY_DIF ;
                    MatchedPOLine.VBquantity_MAX_WithTolerance = MatchedPOLine.VBquantity + MatchedPOLine.VB_IR_QTY_DIF
                    MatchedPOLine.VBquantity_MIN_WithTolerance = MatchedPOLine.VBquantity - MatchedPOLine.VB_IR_QTY_DIF

                    GLB_MatchingLogs += '\nAccepted VB quantity MIN' + MatchedPOLine.VBquantity_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBquantity_MAX_WithTolerance;

                    if ((MatchedPOLine.POquantityreceived >= MatchedPOLine.VBquantity_MIN_WithTolerance) && (MatchedPOLine.POquantityreceived <= MatchedPOLine.VBquantity_MAX_WithTolerance)){
                        GLB_MatchingLogs += '\nIR AND VB QUANTITY MATCH WITH FIXED TOLERANCE LEVEL'
                        MatchedPOLine.lineHasBeenReceivedWithinTolerance = true;
                    } else {
                        MatchedPOLine.lineHasBeenReceivedWithinTolerance = false;
                        GLB_MatchingLogs += '\nIR AND VB QUANTITY NOT MATCH WITH THIS TOLERANCE LEVEL'
                    }
                } else {
                    MatchedPOLine.lineHasBeenReceivedWithinTolerance = false;
                    GLB_MatchingLogs += '\nTOLERANCE LEVELS NOT DEFINED IN THE VENDOR AND IN THE ITEM, NOT MATCHED'
                }
            }
        }

    }

    function _handleMatchStatusComparingVBandPOFXAmountAndQuantity(MatchedPOLine){

        if (MatchedPOLine.POamountFX === MatchedPOLine.VBamountFX){
            MatchedPOLine.lineHasBeenFullyInvoiced = true
            GLB_MatchingLogs += '\nPO AND VB AMOUNT MATCH'
        } else {
            GLB_MatchingLogs += '\nPO AND VB AMOUNT NOT MATCH: APPLYING AMOUNT % TOLERANCE LEVELS'
            if (MatchedPOLine.VB_PO_AMT_TOL > 0){
                GLB_MatchingLogs += '\nAPPLYING A TOLERANCE LEVEL FOR VB AMOUNT OF ' + MatchedPOLine.VB_PO_AMT_TOL + '%';
                MatchedPOLine.VBamountFX_MAX_WithTolerance = MatchedPOLine.VBamountFX + (MatchedPOLine.VBamountFX / 100 * MatchedPOLine.VB_PO_AMT_TOL)
                MatchedPOLine.VBamountFX_MIN_WithTolerance = MatchedPOLine.VBamountFX - (MatchedPOLine.VBamountFX / 100 * MatchedPOLine.VB_PO_AMT_TOL)

                GLB_MatchingLogs += '\nAccepted VB amount MIN ' + MatchedPOLine.VBamountFX_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBamountFX_MAX_WithTolerance;

                if ((MatchedPOLine.POamountFX >= MatchedPOLine.VBamountFX_MIN_WithTolerance) && (MatchedPOLine.POamountFX <= MatchedPOLine.VBamountFX_MAX_WithTolerance)){
                    GLB_MatchingLogs += '\nPO AND VB AMOUNT MATCH WITH TOLERANCE LEVELS'
                    MatchedPOLine.lineHasBeenInvoicedWithinTolerance = true;
                } else {
                    MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                    GLB_MatchingLogs += '\nPO AND VB AMOUNT NOT MATCH WITH TOLERANCE LEVELS'
                }
            } else {
                MatchedPOLine.lineHasBeenFullyInvoiced = false;
                MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                GLB_MatchingLogs += '\nTOLERANCE LEVELS NOT DEFINED IN THE VENDOR AND IN THE ITEM, NOT MATCHED'
            }
        }

        if (MatchedPOLine.lineHasBeenFullyInvoiced || MatchedPOLine.lineHasBeenInvoicedWithinTolerance){
            if (MatchedPOLine.POquantity === MatchedPOLine.VBquantity){
                GLB_MatchingLogs += '\nPO AND VB QUANTITY MATCH'
            } else {
                MatchedPOLine.lineHasBeenFullyInvoiced = false
                GLB_MatchingLogs += '\nPO AND VB QUANTITY NOT MATCH: APPLYING QUANTITY % TOLERANCE LEVEL'

                if (MatchedPOLine.VB_PO_QTY_TOL > 0){
                    GLB_MatchingLogs += '\nAPPLYING A TOLERANCE LEVEL FOR VB QUANTITY OF ' + MatchedPOLine.VB_PO_QTY_TOL + '%';
                    MatchedPOLine.VBquantity_MAX_WithTolerance = MatchedPOLine.VBquantity + (MatchedPOLine.VBquantity / 100 * MatchedPOLine.VB_PO_QTY_TOL)
                    MatchedPOLine.VBquantity_MIN_WithTolerance = MatchedPOLine.VBquantity - (MatchedPOLine.VBquantity / 100 * MatchedPOLine.VB_PO_QTY_TOL)

                    GLB_MatchingLogs += '\nAccepted VB quantity MIN' + MatchedPOLine.VBquantity_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBquantity_MAX_WithTolerance;

                    if ((MatchedPOLine.POquantity >= MatchedPOLine.VBquantity_MIN_WithTolerance) && (MatchedPOLine.POquantity <= MatchedPOLine.VBquantity_MAX_WithTolerance)){
                        GLB_MatchingLogs += '\nPO AND VB QUANTITY MATCH WITH THIS TOLERANCE LEVEL'
                        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = true;
                    } else {
                        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                        GLB_MatchingLogs += '\nPO AND VB QUANTITY NOT MATCH WITH THIS TOLERANCE LEVEL'
                    }
                } else {

                    if (MatchedPOLine.VB_PO_QTY_DIF > 0){
                        GLB_MatchingLogs += '\nAPPLYING A TOLERANCE LEVEL FOR VB FIXED QUANTITY OF ' + MatchedPOLine.VB_PO_QTY_DIF ;
                        MatchedPOLine.VBquantity_MAX_WithTolerance = MatchedPOLine.VBquantity + MatchedPOLine.VB_PO_QTY_DIF
                        MatchedPOLine.VBquantity_MIN_WithTolerance = MatchedPOLine.VBquantity - MatchedPOLine.VB_PO_QTY_DIF

                        GLB_MatchingLogs += '\nAccepted VB quantity MIN' + MatchedPOLine.VBquantity_MIN_WithTolerance + ' MAX: ' + MatchedPOLine.VBquantity_MAX_WithTolerance;

                        if ((MatchedPOLine.POquantity >= MatchedPOLine.VBquantity_MIN_WithTolerance) && (MatchedPOLine.POquantity <= MatchedPOLine.VBquantity_MAX_WithTolerance)){
                            GLB_MatchingLogs += '\nQUANTITY MATCH WITH THIS TOLERANCE LEVEL'
                            MatchedPOLine.lineHasBeenInvoicedWithinTolerance = true;
                        } else {
                            MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                            GLB_MatchingLogs += '\nQUANTITY NOT MATCH WITH THIS TOLERANCE LEVEL'
                        }
                    } else {
                        MatchedPOLine.lineHasBeenInvoicedWithinTolerance = false;
                        GLB_MatchingLogs += '\nTOLERANCE LEVELS NOT DEFINED IN THE VENDOR AND IN THE ITEM, NOT MATCHED'
                    }
                }
            }
        }

        GLB_MatchingLogs += '\nTHIS LINE NOT REQUIRE AN IR MATCHING'
        MatchedPOLine.lineHasBeenFullyReceived = true
        MatchedPOLine.lineHasBeenReceivedWithinTolerance = false

    }

    function _getRecordIdToNameMap(recordType, fieldToMap){
        const RecordIdToNameMap = {};

        var recordIdToNameSearchObj = searchModule.create({
            type: recordType,
            columns:
                [
                    searchModule.createColumn({name: "internalid"}),
                    searchModule.createColumn({name: fieldToMap}),
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

    function _setMatchingStatus(newRecord,sublistLineCount,sublistId,defaultMatchingStatus){

        newRecord.selectLine({
            sublistId: sublistId,
            line: sublistLineCount
        })

        newRecord.setCurrentSublistValue({
            sublistId: sublistId,
            line: sublistLineCount,
            fieldId: 'custcol_h2gs_matching_status',
            value: defaultMatchingStatus
        })

        newRecord.commitLine({
            sublistId: sublistId
        })

/*
        newRecord.setSublistValue({
            sublistId: sublistId,
            fieldId: 'custcol_h2gs_matching_status',
            line: sublistLineCount,
            value: defaultMatchingStatus
        });*/
    }

    function _integerFromRecordIDValue(newRecord,fieldId){
        var fieldValue = newRecord.getValue(fieldId)

        if (fieldValue){
            if (!isNaN(parseInt(fieldValue,10))){
                return parseInt(fieldValue,10)
            }
        }

        return null;
    }

    function _integerFromRecordIDValue_Join(result,fieldId, joinId){
        var fieldValue = result.getValue({name: fieldId ,join: joinId})

        if (fieldValue){
            if (!isNaN(parseInt(fieldValue,10))){
                return parseInt(fieldValue,10)
            }
        }

        return null;
    }

    function _appendToLog(newRecord,newLogToAppend){
        var currentLog = '';// newRecord.getValue('custbody_h2gs_af_approval_matchlog');
        var newLog = '';

        if (firstSessionLog){
            currentLog = ''
            firstSessionLog = false;
            newLog = currentLog + '\n\n' + new Date() + newLogToAppend;
        } else {
            currentLog = newRecord.getValue('custbody_h2gs_af_approval_matchlog');
            newLog = currentLog + '\n' + newLogToAppend;
        }

        newRecord.setValue('custbody_h2gs_af_approval_matchlog', newLog)
    }

    var getLineValue = function (newRecord, sublistLineCount, sublistId, fieldId, convertToInteger){
        var returnValue = null;

        returnValue = newRecord.getSublistValue({
            sublistId: sublistId,
            fieldId: fieldId,
            line: sublistLineCount
        });

        log.debug({
            title: '_handleWFAction matchings',
            details: 'returning.l:-' + returnValue.length + '- returning:-' + returnValue + '-for field id: ' + fieldId + ' on line: ' + sublistLineCount + ' for sublist: ' + sublistId
        });

        if (convertToInteger){
            if (returnValue){
                if (!isNaN(parseInt(returnValue,10))){
                    return parseInt(returnValue,10)
                } else {
                    return null
                }
            } else {
                return null
            }
        }

        return returnValue;
    }

    return {
        onAction: _handleWFAction
    };
});

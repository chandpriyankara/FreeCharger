#!/usr/bin/env node
var util = require('util');
var mysql = require('mysql');
var requestHttp = require('request');
var moment = require('moment');
var OCPP = require('ocpp-js');
var soap = require('strong-soap').soap;
var xml = require('fs').readFileSync('ocpp_centralsystemservice_1.5_final.wsdl', 'utf8');
var http = require('http');

var connectionsql = mysql.createConnection({
	host: 'localhost',
	user: 'evuser_demo',
	password: 'EVpointDev!9f2A',
	database: 'ev_points_demo',
	port: '3306'
});
connectionsql.connect();

var server = http.createServer(function (request, response) {
	console.log((new Date()).toISOString() + ' Received request for ' + request.url);
	//response.writeHead(404);
	//response.end();
});

server.listen(8083, '127.0.0.1', function () {
	console.log('-----------------------------------listen---------------------------------------------');
	var tmpDate = new Date();
	console.log(tmpDate.toISOString() + ' [' + tmpDate.getTime() + ']' + ' Server is listening on port 8083');
});

function originIsAllowed(origin, callback) {
	console.log('OriginaIsAll...');
	path = origin.replace(/\//g, "");

	if (path == "") {
		callback(false, 0, '');
	}
	var sql = "SELECT id, name, location, regid, authorized FROM ev_points WHERE regid = ?";
	var inserts = [path];
	sql = mysql.format(sql, inserts);
	connectionsql.query(sql, function (err, rows, fields) {
		if (err) {
			throw err;
			callback(false, null);
		}

		if (rows.length == 1) {
			if ((rows[0].regid == path) && (rows[0].authorized == 1)) {
				var pointDetails = rows[0];
				callback(true, pointDetails);
			}
			else {

				callback(false, null);
			}

		}
		else {
			callback(false, null);
		}

	});
}

function Process(args, callback, headers, request) {
	console.log('WS Request endpoint: ' + headers.chargeBoxIdentity.$value + ' Action:' + headers.Action.$value + '\n' + JSON.stringify(headers) + '\n' + JSON.stringify(args));
	var evpointName = headers.chargeBoxIdentity.$value;
	var uuid = 'uuid:' + headers.MessageID.split(':')[2];
	var pointDetails;
	var sql = "SELECT * FROM ev_points WHERE regid = ?";
	var inserts = [evpointName];
	sql = mysql.format(sql, inserts);
	connectionsql.query(sql, function (err, rowsM, fields) {
		console.log('stage 1');
		if (err) {
			throw err;
		}
		if (rowsM.length == 1) {
			console.log('stage 2');
			pointDetails = rowsM[0];
			var evName = pointDetails.name;
			var evLocation = pointDetails.location;
			var chargePointSerialNumber = headers.chargePointSerialNumber;
			var remoteAddress = headers.From.Address;
			var evpoint = pointDetails.id;

			if (pointDetails.authorized == 1) {
				console.log('stage 3');

				switch (headers.Action.$value) {
					case '/BootNotification':
						{
							console.log('BootNotification');
							var imsi = pointDetails.imsi;
							var firmwareVersion = pointDetails.firmwareVersion;
							var chargePointVendor = pointDetails.chargePointVendor;
							var iccid = pointDetails.iccid;
							var chargePointModel = pointDetails.chargePointModel;

							var sql = "INSERT INTO boot_notification_log ( evpoint, chargePointVendor, ip, chargePointModel, chargePointSerialNumber, chargeBoxSerialNumber, firmwareVersion, iccid, imsi, meterType, meterSerialNumber ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
							var inserts = [evpoint, chargePointVendor, remoteAddress, chargePointModel, chargePointSerialNumber, 0, firmwareVersion, iccid, imsi, 0, 0];
							sql = mysql.format(sql, inserts);
							connectionsql.query(sql, function (err, rows, fields) {
								console.log('stage 4');
								if (err) {
									throw err;
								}
								var sql = "UPDATE ev_points SET ip = ?, chargePointModel = ?, chargePointSerialNumber = ?, imsi = ?, firmwareVersion = ?, chargePointVendor = ?, iccid = ? WHERE id = ?;";
								var inserts = [remoteAddress, chargePointModel, chargePointSerialNumber, imsi, firmwareVersion, chargePointVendor, iccid, evpoint];
								sql = mysql.format(sql, inserts);
								connectionsql.query(sql, function (err, rows, fields) {
									console.log('stage 5');
									if (err) {
										// throw err; 
									}
									var date = new Date().toISOString();
									var datablob =
									{
										bootNotificationResponse: {
											status: 'Accepted',
											currentTime: date,
											heartbeatInterval: 35
										}
									};
									callback(datablob);
									console.log('WS Replied :' + JSON.stringify(datablob));
								});
							});
						}
						break;
					case '/Authorize':
						{
							var idTag = args.idTag;
							//check for user 
							var sql = "SELECT d2.id, d1.rowid as reg_id, d2.deposite, d2.emergency_charge, d2.status, balance FROM available_cards d1, consumer_details d2 WHERE d1.reg_id = ? AND d1.rowid = d2.cardid";
							var inserts = [idTag];
							sql = mysql.format(sql, inserts);
							connectionsql.query(sql, function (err, rows, fields) {
								if (err) throw err;
								if (rows.length > 0) {

									var id = rows[0].id;
									var card_reg = rows[0].reg_id;
									var deposite = rows[0].deposite;
									var emergency_charge = rows[0].emergency_charge;
									var status = rows[0].status;
									var balance = rows[0].balance;
									var start = new Date().getTime() / 1000;
									if (status == 3) {
										//user expired
										var sql = "INSERT INTO authorize_log (cardid, consumerid, credit_limit, evpoint, machineid, authorized, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?);";
										var inserts = [card_reg, id, balance, evpoint, path, 0, 'Expired', start];
										sql = mysql.format(sql, inserts);
										connectionsql.query(sql, function (err, rows, fields) {
											console.log('Authorize - authorize_log - 3 - ' + rows);
											if (err) {
												throw err;
											}

											var datablob =
											{
												AuthorizeResponse: {
													idTagInfo: {
														status: 'Expired'
													}
												}
											};
											callback(datablob);
											console.log('WS Replied :' + JSON.stringify(datablob));
										});


									} else if (status == 1) {
										//user active
										if (balance > 0) {
											var sql = "INSERT INTO authorize_log (cardid, consumerid, credit_limit, evpoint, machineid, authorized, deposite, status, timestamp ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? );";
											var inserts = [card_reg, id, balance, evpoint, path, 1, deposite, 'Accepted', start];
											sql = mysql.format(sql, inserts);
											connectionsql.query(sql, function (err, rows, fields) {
												console.log('Normal Charge :' + balance);
												if (err) {
													throw err;
												}
												var datablob =
												{
													AuthorizeResponse: {
														idTagInfo: {
															status: 'Accepted'
														}
													}
												};
												callback(datablob);
												console.log('WS Replied :' + JSON.stringify(datablob));
											});
										} else if (!(balance > 0) && (emergency_charge == deposite)) {
											var sql = "INSERT INTO authorize_log (cardid, consumerid, credit_limit, evpoint, machineid, authorized, is_emergency, deposite, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? );";
											var inserts = [card_reg, id, balance, evpoint, path, 1, 1, deposite, 'Accepted', start];
											sql = mysql.format(sql, inserts);
											connectionsql.query(sql, function (err, rows, fields) {
												console.log('Emergency Charge :' + balance + ' : ' + deposite);
												if (err) {
													throw err;
												}
												var datablob =
												{
													AuthorizeResponse: {
														idTagInfo: {
															status: 'Accepted'
														}
													}
												};
												callback(datablob);
												console.log('WS Replied :' + JSON.stringify(datablob));
											});
										} else {
											var sql = "INSERT INTO authorize_log (cardid, consumerid, credit_limit, evpoint, machineid, authorized, deposite, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? );";
											var inserts = [card_reg, id, balance, evpoint, path, 0, deposite, 'Blocked', start];
											sql = mysql.format(sql, inserts);
											connectionsql.query(sql, function (err, rows, fields) {
												console.log('Charge Rejected :' + balance + ' : ' + deposite);
												if (err) {
													throw err;
												}
												var datablob =
												{
													AuthorizeResponse: {
														idTagInfo: {
															status: 'Expired'
														}
													}
												};
												callback(datablob);
												console.log('WS Replied :' + JSON.stringify(datablob));
											});
										}

									} else {
										var datablob =
										{
											AuthorizeResponse: {
												idTagInfo: {
													status: 'Invalid'
												}
											}
										};
										callback(datablob);
										console.log('WS Replied :' + JSON.stringify(datablob));
									}

								} else {
									//user does not exist 
									var datablob =
									{
										AuthorizeResponse: {
											idTagInfo: {
												status: 'Invalid'
											}
										}
									};
									callback(datablob);
									console.log('WS Replied :' + JSON.stringify(datablob));
								}

							});
						}
						break;
					case '/StartTransaction':
						{
							var idTag = args.idTag;
							var meterStart = pointDetails.meterStart;
							var connectorId = pointDetails.connectorId;
							var start = new Date().getTime() / 1000;
							try {
								var tmpStart = Math.floor(new Date(pointDetails.timestamp).getTime() / 1000);
								if (tmpStart)
									start = tmpStart;
							}
							catch (err) {
								console.log(err);
							}

							if (idTag == "00000000") {
								var sql = "SELECT * from site_settings where property = ? ";
								var inserts = ['minute_price_small'];
								sql = mysql.format(sql, inserts);
								connectionsql.query(sql, function (err, rows, fields) {
									if (err) {
										throw err;
									}
									var unit_price = rows[0].value;
									var sql = "INSERT INTO ev_sessions (consumerid, credit_limit, evpoint, idTag, connectorId, start, unit_cost, status, is_emergency ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);";
									var inserts = [1, 5000, evpoint, idTag, connectorId, start, unit_price, 1, 0];
									sql = mysql.format(sql, inserts);
									connectionsql.query(sql, function (err, rows, fields) {
										if (err) throw err;
										var transactionid = rows.insertId;
										var datablob =
										{
											StartTransactionResponse: {
												transactionId: transactionid,
												idTagInfo: {
													status: 'Accepted'
												}
											}
										};
										callback(datablob);
										console.log('WS Replied :' + JSON.stringify(datablob));
									});
								});

							} else {
								var sql = "SELECT consumer_details.phone, consumer_details.sms_notification, authorize_log.rowid, authorize_log.consumerid, authorize_log.credit_limit, authorize_log.evpoint, authorize_log.is_emergency, authorize_log.authorized, authorize_log.deposite, authorize_log.timestamp from authorize_log, consumer_details, available_cards WHERE available_cards.reg_id = ? AND available_cards.rowid = consumer_details.cardid AND authorize_log.consumerid = consumer_details.id AND evpoint = ? ORDER BY authorize_log.rowid DESC LIMIT 1";
								var inserts = [idTag, evpoint];
								sql = mysql.format(sql, inserts);
								connectionsql.query(sql, function (err, rows, fields) {

									if (err) {
										throw err;
									}
									// console.log('Authorize-log : ', JSON.stringify( rows ) );
									if (rows.length > 0) {
										var authLog = rows[0];
										if ((authLog.authorized == 1) && (authLog.timestamp > (start - 300))) {
											var sms_notification = authLog.sms_notification;
											var phoneNumber = authLog.phone;
											var is_emergency = authLog.is_emergency;
											var deposite_log = authLog.deposite;
											var consumerid = authLog.consumerid;
											var credit_limit = authLog.credit_limit;
											if (is_emergency == 1) {
												credit_limit = deposite_log;
											}
											var sql = "SELECT * from site_settings where property = ? ";
											var inserts = ['minute_price_small'];
											sql = mysql.format(sql, inserts);
											connectionsql.query(sql, function (err, rows, fields) {
												if (err) {
													throw err;
												}
												var unit_price = rows[0].value;
												var sql = "INSERT INTO ev_sessions (consumerid, credit_limit, evpoint, idTag, connectorId, start, unit_cost, status, is_emergency ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);";
												var inserts = [consumerid, credit_limit, evpoint, idTag, connectorId, start, unit_price, 1, is_emergency];
												sql = mysql.format(sql, inserts);
												connectionsql.query(sql, function (err, rows, fields) {
													if (err) throw err;
													var transactionid = rows.insertId;
													var datablob =
													{
														StartTransactionResponse: {
															transactionId: transactionid,
															idTagInfo: {
																status: 'Accepted'
															}
														}
													};
													callback(datablob);
													console.log('WS Replied :' + JSON.stringify(datablob));
													if (sms_notification == 1) {
														credit_limit = parseFloat(credit_limit).toFixed(2);
														balance = credit_limit.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
														sendDialogSMS(phoneNumber, 'Charging Session Authorized. Available balance Rs ' + balance);
													}
												});
											});
										} else {
											last_offline_transaction = start;
											var datablob =
											{
												StartTransactionResponse: {
													transactionId: 0,
													idTagInfo: {
														status: 'Blocked'
													}
												}
											};
											callback(datablob);
											console.log('WS Replied :' + JSON.stringify(datablob));
										}
									} else {
										last_offline_transaction = start;
										var datablob =
										{
											StartTransactionResponse: {
												transactionId: 0,
												idTagInfo: {
													status: 'Blocked'
												}
											}
										};
										callback(datablob);
										console.log('WS Replied :' + JSON.stringify(datablob));
									}
								});
							}
						}
						break;
					case '/StopTransaction':
						{
							var idTag = args.idTag;
							var uid = transactionid = pointDetails.transactionId;
							var start = new Date().getTime() / 1000;
							try {
								start = Math.floor(new Date(pointDetails.timestamp).getTime() / 1000);
							}
							catch (err) {

							}
							if (uid == 0) {
								// console.log( 'Missed Transaction :', JSON.stringify( pointDetails ) );
								var sql = "SELECT * from site_settings where property = ? ";
								var inserts = ['minute_price_small'];
								sql = mysql.format(sql, inserts);
								connectionsql.query(sql, function (err, rows, fields) {
									// if (err) {
									//     throw err;
									// }
									if (rows.length > 0) {
										var unit_price_row = rows[0];
										var unit_price = parseFloat(unit_price_row.value);

										var sql = "SELECT d2.id, d1.rowid as reg_id, d2.deposite, d2.emergency_charge, d2.status, balance FROM available_cards d1, consumer_details d2 WHERE d1.reg_id = ? AND d1.rowid = d2.cardid";
										var inserts = [idTag];
										sql = mysql.format(sql, inserts);
										connectionsql.query(sql, function (err, rows, fields) {
											if (err) throw err;
											// var consumerid = null;
											if (rows.length > 0) {
												console.log('Offline Transaction :', JSON.stringify(pointDetails));
												var consumer = rows[0];

												var units = parseFloat(pointDetails.meterStop) / 1000;
												var unit_price = parseFloat(unit_price_row.value);
												var timestamp = apointDetails.timestamp;
												var credit_usage = unit_price * units;
												try {
													var startTimestamp = rows[0].start;
													var stopTimeStamp = start;
													var sessionTime = stopTimeStamp - startTimestamp;
													credit_usage = (sessionTime / 60) * unit_cost;
													console.log("Time(per Minutes) based billing:" + (sessionTime / 60) + "*" + unit_cost + " = " + credit_usage + " [" + units + "KWh]");
												} catch (err) {
													console.log(err);
												}
												var balance = consumer.balance - credit_usage;
												var end = start;
												if (last_offline_transaction != 0) {
													start = last_offline_transaction;
												}

												// var sql = "INSERT INTO missed_sessions ( consumerid, evpoint, idTag, end, unit_cost, units, credit_usage, machine_timestamp ) VALUES (?, ?, ?, ?, ?, ?, ?, ? );";
												// var inserts = [ consumer.id, evpoint, idtoken, end, unit_price, units, credit_usage, timestamp  ];
												// sql = mysql.format(sql, inserts);
												// connectionsql.query(sql, function(err, rows, fields) {
												//     if (err) throw err;
												//     session = rows.insertId;
												// });

												var sql = "INSERT INTO ev_sessions (consumerid, evpoint, credit_limit, idTag, connectorId, start, end, unit_cost, units, credit_usage, balance, is_offline ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
												var inserts = [consumer.id, evpoint, consumer.balance, idtoken, 0, start, end, unit_price, units, credit_usage, balance, 1];
												sql = mysql.format(sql, inserts);
												connectionsql.query(sql, function (err, rows, fields) {
													if (err) throw err;
													session = rows.insertId;

													last_offline_transaction = 0;
													var sql = "INSERT INTO consumer_trasnactions (consumerid, is_debit, amount, description, location, referance, type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ? );";
													var inserts = [consumer.id, 0, credit_usage, 'Offline', location, session, 2, end];
													sql = mysql.format(sql, inserts);
													connectionsql.query(sql, function (err, rows, fields) {
														if (err) {
															throw err;
														}

														var sql = "UPDATE consumer_details SET balance = ? WHERE id = ? ;";
														var inserts = [balance, consumer.id];
														sql = mysql.format(sql, inserts);
														connectionsql.query(sql, function (err, rows, fields) {
															if (err) {
																throw err;
															}

															var datablob =
															{
																StopTransactionResponse: {
																	idTagInfo: {
																		status: 'Accepted'
																	}
																}
															};
															callback(datablob);
															console.log('WS Replied :' + JSON.stringify(datablob));
															if (consumer.sms_notification == 1) {
																credit_usage = parseFloat(credit_usage).toFixed(2);
																try {
																	var startTimestamp = rows[0].start;
																	var stopTimeStamp = start;
																	var sessionTime = stopTimeStamp - startTimestamp;
																	credit_usage = (sessionTime / 60) * unit_cost;
																	console.log("Time(per Minutes) based billing:" + (sessionTime / 60) + "*" + unit_cost + " = " + credit_usage + " [" + units + "KWh]");
																} catch (err) {
																	console.log(err);
																}
																current_balance = parseFloat(current_balance).toFixed(2);
																amount = credit_usage.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
																balance = current_balance.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
																var date = moment(start * 1000);
																var converted_date = date.format("YYYY-MM-DD H:m");
																sendDialogSMS(consumer.phone, 'Rs ' + amount + 'has been recovered from your account for ' + units + ' kWh units charged on ' + date + ', Available Balance Rs ' + balance);
															}
														});
													});
													// var idtoken = actioncode[3].idTag;
													// var transactionid = session;
													// var datablob = { 
													// idTagInfo : { status: "Accepted"}, 
													//     transactionId: transactionid  
													// }
													// var object = jsonMaker(3,actioncode[1],datablob);
													// var object = JSON.stringify(object);
													// connection.sendUTF(object);
													// console.log('WS Replied :' +  object );
												});
												// var unit_price = rows[0].value;
												// var units = parseFloat( actioncode[3].meterStop ) / 1000;
												// var timestamp = actioncode[3].timestamp;
												// var credit_usage = unit_price * units;

											} else {
												console.log('Missed Transaction :', JSON.stringify(actioncode[3]));
												// var unit_price = rows[0].value;
												var unit_price = parseFloat(unit_price_row.value);
												var units = parseFloat(actioncode[3].meterStop) / 1000;
												var timestamp = actioncode[3].timestamp;
												var credit_usage = unit_price * units;
												try {
													var startTimestamp = rows[0].start;
													var stopTimeStamp = start;
													var sessionTime = stopTimeStamp - startTimestamp;
													credit_usage = (sessionTime / 60) * unit_cost;
													console.log("Time(per Minutes) based billing:" + (sessionTime / 60) + "*" + unit_cost + " = " + credit_usage + " [" + units + "KWh]");
												} catch (err) {
													console.log(err);
												}
												//var balance = consumer.balance - credit_usage;
												var end = start;
												if (last_offline_transaction != 0) {
													start = last_offline_transaction;
												}

												var sql = "INSERT INTO missed_sessions ( evpoint, idTag, end, unit_cost, units, credit_usage, machine_timestamp ) VALUES ( ?, ?, ?, ?, ?, ?, ? );";
												var inserts = [evpoint, idTag, end, unit_price, units, credit_usage, timestamp];
												sql = mysql.format(sql, inserts);
												connectionsql.query(sql, function (err, rows, fields) {
													if (err) throw err;
													session = rows.insertId;

													var datablob =
													{
														StopTransactionResponse: {
															idTagInfo: {
																status: 'Accepted'
															}
														}
													};
													callback(datablob);
													console.log('WS Replied :' + JSON.stringify(datablob));
												});
											}

										});
									} else {

									}
								});

							} else {
								var location = evName + ' - ' + evLocation;
								var sql = "SELECT * FROM ev_sessions WHERE evpoint = ? AND status = ? AND rowid = ?;";
								var inserts = [evpoint, 1, uid];
								sql = mysql.format(sql, inserts);
								connectionsql.query(sql, function (err, rows, fields) {
									if (err) {
										throw err;
									}
									if (rows.length > 0) {
										var units = parseFloat(actioncode[3].meterStop) / 1000;
										var sessionid = rows[0].rowid;
										var is_emergency = rows[0].is_emergency;

										var credit_limit = parseFloat(rows[0].credit_limit);
										var unit_cost = parseFloat(rows[0].unit_cost);
										var end = start;
										var credit_usage = unit_cost * units;
										var consumerid = rows[0].consumerid;
										try {
											var startTimestamp = rows[0].start;
											var stopTimeStamp = start;
											var sessionTime = stopTimeStamp - startTimestamp;
											credit_usage = (sessionTime / 60) * unit_cost;
											console.log("Time(per Minutes) based billing:" + (sessionTime / 60) + "*" + unit_cost + " = " + credit_usage + " [" + units + "KWh]");
										} catch (err) {
											console.log(err);
										}

										// console.log( credit_limit, unit_cost, units, credit_usage );
										var sql = "SELECT * FROM consumer_details WHERE id = ? ;";
										var inserts = [consumerid];
										sql = mysql.format(sql, inserts);
										connectionsql.query(sql, function (err, rows, fields) {
											if (err) {
												throw err;
											}
											var sms_notification = rows[0].sms_notification;
											var phoneNumber = rows[0].phone;
											var current_balance = rows[0].balance;
											var emergency_charge1 = rows[0].emergency_charge;
											current_balance = current_balance - credit_usage;
											var emergency_charge = 0;
											if (is_emergency == 1) {
												emergency_charge = emergency_charge1 - credit_usage;
											}
											var sql = "UPDATE consumer_details SET balance = ?, emergency_charge = ? WHERE id = ? ;";
											var inserts = [current_balance, emergency_charge, consumerid];
											sql = mysql.format(sql, inserts);
											connectionsql.query(sql, function (err, rows, fields) {
												if (err) {
													throw err;
												}
												var sql = "INSERT INTO consumer_trasnactions (consumerid, is_debit, amount, description, location, referance, type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ? );";
												var inserts = [consumerid, 0, credit_usage, '', location, uid, 2, end];
												sql = mysql.format(sql, inserts);
												connectionsql.query(sql, function (err, rows, fields) {
													if (err) {
														throw err;
													}
													var datablob =
													{
														StopTransactionResponse: {
															idTagInfo: {
																status: 'Accepted'
															}
														}
													};
													callback(datablob);
													console.log('WS Replied :' + JSON.stringify(datablob));
												});
												var sql = "UPDATE ev_sessions SET units = ?, end = ?, credit_usage = ?, balance = ?, status = 0 WHERE rowid = ?;";
												var inserts = [units, end, credit_usage, current_balance, sessionid];
												sql = mysql.format(sql, inserts);
												connectionsql.query(sql, function (err, rows, fields) {
													if (err) {
														throw err;
													}

												});
												if (sms_notification == 1) {
													credit_usage = parseFloat(credit_usage).toFixed(2);
													current_balance = parseFloat(current_balance).toFixed(2);
													amount = credit_usage.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
													balance = current_balance.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
													sendDialogSMS(phoneNumber, 'Charging Session Stopped. Units - ' + units + ' kWh, Amount -  Rs ' + amount + ', Available Balance -  Rs ' + balance);
												}

											});
										});

									} else {
										var datablob =
										{
											StopTransactionResponse: {
												idTagInfo: {
													status: 'Accepted'
												}
											}
										};
										callback(datablob);
										console.log('WS Replied :' + JSON.stringify(datablob));
									}
								});
							}
						}
						break;
					case '/Heartbeat':
						{
							var date = new Date().toISOString();
							var exists = 0;

							// var status = 1;
							// var sql = "INSERT INTO heartbeats ( evpoint, status, date ) VALUES (?, ?, ? );";
							// var inserts = [ evpoint, status, date ];
							// sql = mysql.format(sql, inserts);
							// connectionsql.query(sql, function(err, rows, fields){

							var datablob =
							{
								heartbeatResponse: {
									currentTime: new Date().toISOString()
								}
							};
							callback(datablob);
							console.log('WS Replied :' + JSON.stringify(datablob));

							// });

							if (pointDetails.remote_start == 1) {
								user = pointDetails.remote_start_user;
								var sql = "SELECT d1.reg_id FROM available_cards d1, consumer_details d2 WHERE d2.id = ? AND d1.rowid = d2.cardid";
								var inserts = [user];

								sql = mysql.format(sql, inserts);
								connectionsql.query(sql, function (err, rows2, fields) {
									if (rows2.length > 0) {
										var datablob =
										{
											RemoteStartTransaction: {
												idTag: rows2[0].reg_id
											}
										};
										callback(datablob);
										console.log('WS Replied :' + JSON.stringify(datablob));
									} else {

									}
									var sql = "UPDATE ev_points SET remote_start = ? , remote_start_user = ? WHERE id = ?;";
									var inserts = [0, 0, evpoint];
									sql = mysql.format(sql, inserts);
									connectionsql.query(sql, function (err, rows, fields) {
										if (err) {
											throw err;
										}

									});
								});
							}
						}
						break;
					case '/MeterValues':
						{
							var uid = args.transactionId;

							var sql = "SELECT * FROM ev_sessions WHERE evpoint = ? AND status = ? AND rowid = ?;";
							var inserts = [evpoint, 1, uid];
							sql = mysql.format(sql, inserts);
							connectionsql.query(sql, function (err, rows, fields) {
								if (err) {
									throw err;
								}
								if (rows.length > 0) {
									var units = parseFloat(args.values.value.$value) / 1000;
									var importPw = parseFloat(args.values.value.attributes.unit);
									var percentage = 50;
									var sessionid = rows[0].rowid;
									var credit_limit = parseFloat(rows[0].credit_limit);
									var unit_cost = parseFloat(rows[0].unit_cost);
									var credit_usage = unit_cost * units;
									try {
										var startTimestamp = rows[0].start;
										var stopTimeStamp = Math.floor(new Date(args.values.timestamp).getTime() / 1000);
										var sessionTime = stopTimeStamp - startTimestamp;
										credit_usage = (sessionTime / 60) * unit_cost;
										console.log("Time(per Minutes) based billing:" + (sessionTime / 60) + "*" + unit_cost + " = " + credit_usage);
									}
									catch (err) {
										console.log(err);
									}
									var sql = "UPDATE ev_sessions SET units = ?, percentage = ?, credit_usage= ? WHERE rowid = ?;";
									var inserts = [units, percentage, credit_usage, sessionid];
									sql = mysql.format(sql, inserts);
									connectionsql.query(sql, function (err, rows1, fields) {
										if (err) {
											throw err;
										}
										if (credit_limit <= credit_usage) {
											var transactionID = args.transactionId;
											console.log('Transaction terminating due to low creadit:' + transactionID);

											var datablob =
											{
												RemoteStopTransaction: {
													transactionId: transactionID
												}
											};
											callback(datablob);
											console.log('WS Replied :' + JSON.stringify(datablob));
										} else {
										}
									});
									var meterStart = actioncode[3].meterStart;
									var idTag = rows[0].idTag;
									var connectorId = args.connectorId;
									var sql = "INSERT INTO session_log (sessionid, connectorId, import, value, percentage, idTag) VALUES (?, ?, ?, ?, ?, ? );";
									var inserts = [sessionid, connectorId, importPw, units, percentage, idTag];
									sql = mysql.format(sql, inserts);
									connectionsql.query(sql, function (err, rows, fields) {
										if (err) throw err;
										var datablob =
										{
											MeterValuesResponse: {}
										};
										callback(datablob);
										console.log('WS Replied :' + JSON.stringify(datablob));
									});
								} else {
									var datablob =
									{
										MeterValuesResponse: {}
									};
									callback(datablob);
									console.log('WS Replied :' + JSON.stringify(datablob));

									var datablob =
									{
										StartTransactionResponse: {
											transactionId: 0,
											idTagInfo: {
												status: 'Blocked'
											}
										}
									};
									callback(datablob);
									console.log('WS Replied :' + JSON.stringify(datablob));
								}
							});
							if (pointDetails.remote_stop == 1) {
								var datablob =
								{
									MeterValuesResponse: {}
								};
								callback(datablob);
								console.log('WS Replied :' + JSON.stringify(datablob));

								var datablob =
								{
									RemoteStopTransaction: {
										transactionId: 0
									}
								};
								callback(datablob);
								console.log('WS Replied :' + JSON.stringify(datablob));

								var sql = "UPDATE ev_points SET remote_stop = ? WHERE id = ?;";
								var inserts = [0, evpoint];
								sql = mysql.format(sql, inserts);
								connectionsql.query(sql, function (err, rows, fields) {
									if (err) {
										throw err;
									}
								});
							}
						}
						break;
					case '/StatusNotification':
						{
							var status = args.status;
							var statusval;
							if (status == 'Available') { statusval = 1; }
							if (status == 'Unavailable') { statusval = 2; }
							if (status == 'Charging') { statusval = 3; }
							if (status == 'Faulted') { statusval = 4; }
							if (status == 'Preparing') { statusval = 5; }
							if (status == 'Finishing') { statusval = 6; }
							if (status == 'Occupied') { statusval = 7; }
							if (status == 'Reserved') { statusval = 8; }
							var sql = "UPDATE ev_points SET status = ? WHERE id = ?;";
							var inserts = [statusval, evpoint];
							sql = mysql.format(sql, inserts);
							connectionsql.query(sql, function (err, rows, fields) {
								if (err) {
									throw err;
								}
								var date = new Date().toISOString();
								var datablob =
								{
									StatusNotificationResponse: {}
								};
								callback(datablob);
								console.log('WS Replied :' + JSON.stringify(datablob));
							});
						}
						break;
					case '/FirmwareStatusNotification':
						break;
					case '/DiagnosticsStatusNotification':
						break;
					case '/DataTransfer':
						break;
					default:
						console.log(`Sorry, we are out of ${headers.Action.$value}.`);
				}
			}
			console.log('stage 3 false');
		}
		console.log('stage 2 false');
	});
	console.log('stage 1 false');
	//callback("Error");
}

var CentralSystemService = {
	CentralSystemService: {
		CentralSystemServiceSoap12: {
			BootNotification: Process,
			Authorize: Process,
			StartTransaction: Process,
			StopTransaction: Process,
			Heartbeat: Process,
			MeterValues: Process,
			StatusNotification: Process,
			FirmwareStatusNotification: Process,
			DiagnosticsStatusNotification: Process,
			DataTransfer: Process
		}
	}
};

// SOAP Server listener
var soapServer = soap.listen(server, "/Ocpp/CentralSystemService", CentralSystemService, xml);
soapServer.on('request', function (request, response) {
	console.log('-------------------------------------request-------------------------------------------');

	originIsAllowed(request.Header.chargeBoxIdentity.$value, function (authorised, pointDetails) {
		if(!pointDetails) return;
		var charBox = request.Header.chargeBoxIdentity.$value;
		if (!authorised) {
			console.log((new Date()).toISOString() + ' Connection from origin ' + request.Header.From.Address + ' [URL: ' + charBox + '] rejected.');
			response.end();
			return;
		}

		console.log((new Date()).toISOString() + ' Connection accepted from machine ' + pointDetails.name + ', ' + pointDetails.location + '[' + charBox + ']');
		logMachineConnection(pointDetails.id, 1);
	});
});

function logMachineConnection(pointid, status) {
	console.log('logMachineConnection');
	var sql = "INSERT INTO machine_connections ( evpoint, status, date_time, timestamp ) VALUES ( ?, ?, ?, ? );";
	var inserts = [pointid, status, new Date() + '', new Date().getTime() / 1000];
	sql = mysql.format(sql, inserts);
	connectionsql.query(sql, function (err, rows, fields) {
		console.log('logMachineConnection sql done');
	});

	//Last logged in time
	var today = new Date().getTime() / 1000;
	var sql = "UPDATE ev_points SET last_connect = ? WHERE id = ?;";
	var inserts = [today, pointid];
	sql = mysql.format(sql, inserts);
	connectionsql.query(sql, function (err, rows, fields) {
		if (err) {
			throw err;
		} else {
			console.log('last connection time [' + today + '] updated for evpointid:' + pointid);
		}
	});
}

function sendDialogSMS(number, msg) {
	while (number.charAt(0) === '0') {
		number = number.substr(1);
	}
	number = '94' + number;
	console.log('SMS : ' + number, msg);
	requestHttp.post(
		'https://smsapi.com/api/sms/send?token=REDACTED_DEMO_TOKEN&mobile_number=' + number + '&content=' + encodeURI(msg), {},
		function (error, response, body) {
			// console.log( 'sendDialogSMS-reply', JSON.stringify( error ), JSON.stringify( response ), JSON.stringify( body ) );
		}
	);
}

function jsonMaker(actionid, uuid, dataobject) {

	var jsondata = [actionid, uuid, dataobject];

	jasondata = JSON.stringify(jsondata);

	return jsondata;
}

function jsonMaker2(actionid, uuid, request, dataobject) {

	var jsondata = [actionid, uuid, request, dataobject];

	jasondata = JSON.stringify(jsondata);

	return jsondata;
}

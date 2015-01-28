// This is a dummy file to make sure that we typescheck the freedom-stypescript-
// api files.
/// <reference path='./freedom-common.d.ts' />
/// <reference path='./freedom-module-env.d.ts' />
/// <reference path='console.d.ts' />
/// <reference path='pgp.d.ts' />
/// <reference path='social.d.ts' />
/// <reference path='storage.d.ts' />
/// <reference path='tcp-socket.d.ts' />
/// <reference path='udp-socket.d.ts' />
/// <reference path='transport.d.ts' />
/// <reference path='rtcdatachannel.d.ts' />
/// <reference path='rtcpeerconnection.d.ts' />
var parentModule = freedom();
parentModule.on('message', function (x) {
    console.log('got a message: ' + x);
});
parentModule.emit('message', 'foo message');
// Logger variable, initially unbound, but get bound later.
var logger = null;
// Create a logger for this module.
var freedomCore = freedom.core();
freedomCore.getLogger('[Test Module]').then(function (bound_logger) {
    logger = bound_logger;
    logger.log('logger ready');
}).then(freedomCore.getId).then(function (id) {
    logger.log('id: ', logger);
});
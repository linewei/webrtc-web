'use strict';

var isChannelReady = false;
var isInitiator = false; //socket.io create room
var isStarted = false;	//local stream added
let hasRemote = false;	//remote stream added
var localStream;
var pcs = [];
var currPc = null;
var remoteStream1;
var remoteStream2;
var turnReady;

var pcConfig = {
	'iceServers': [{
		'urls': 'stun:stun.l.google.com:19302'
	}]
};
/*
var pcinfo = {
	sockID:XXX,
	pc:XXX,
	stream:XXX
};

*/

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
	offerToReceiveAudio: true,
	offerToReceiveVideo: true
};

/////////////////////////////////////////////

var room = 'foo';
// Could prompt for room name:
// room = prompt('Enter room name:');

var socket = io.connect();

if (room !== '') {
	socket.emit('create or join', room);
	console.log('Attempted to create or  join room', room);
}

socket.on('created', function(room) {
	console.log('Created room ' + room);
	isInitiator = true;
});

socket.on('full', function(room) {
	console.log('Room ' + room + ' is full');
});

socket.on('join', function (room){
	console.log('Another peer made a request to join room ' + room);
	console.log('This peer is the initiator of room ' + room + '!');
	isChannelReady = true;
});

socket.on('joined', function(room) {
	console.log('joined: ' + room);
	isChannelReady = true;
});

socket.on('log', function(array) {
	console.log.apply(console, array);
});

////////////////////////////////////////////////

function sendMessage(message) {
	console.log('Client sending message: ', message);
	socket.emit('message', message);
}

// This client receives a message
socket.on('message', function(message) {
	console.log('Client received message:', message);
	if (message === 'got user media') {
		maybeStart();
	} else if (message.type === 'offer') {
		if (!isInitiator && !isStarted) {
			maybeStart();
		}
		try{
			currPc.setRemoteDescription(new RTCSessionDescription(message));
		}catch(e){
			console.log(e);
		}

		doAnswer();
	} else if (message.type === 'answer' && isStarted) {
		try{
			currPc.setRemoteDescription(new RTCSessionDescription(message));
		}catch(e){
			console.log(e);
		}
	} else if (message.type === 'candidate' && isStarted) {
		var candidate = new RTCIceCandidate({
			sdpMLineIndex: message.label,
			candidate: message.candidate
		});
		currPc.addIceCandidate(candidate);
	} else if (message === 'bye' && isStarted) {
		handleRemoteHangup();
	}
});

////////////////////////////////////////////////////

var localVideo = document.querySelector('#localVideo');
var remoteVideo1 = document.querySelector('#remoteVideo1');
var remoteVideo2 = document.querySelector('#remoteVideo2');

navigator.mediaDevices.getUserMedia({
	audio: false,
	video: true
})
	.then(gotStream)
	.catch(function(e) {
		alert('getUserMedia() error: ' + e.name);
	});

function gotStream(stream) {
	console.log('Adding local stream.');
	localStream = stream;
	localVideo.srcObject = stream;
	sendMessage('got user media');
	if (isInitiator) {
		maybeStart();
	}
}

var constraints = {
	video: true
};

console.log('Getting user media with constraints', constraints);

if (location.hostname !== 'localhost') {
	requestTurn(
		'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
	);
}

function maybeStart() {
	console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
	if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
		console.log('>>>>>> creating peer connection');
		createPeerConnection();
		currPc.addStream(localStream);
		isStarted = true;
		console.log('isInitiator', isInitiator);
		if (isInitiator) {
			doCall();
		}
	}
	else if(isStarted && isInitiator){
		doCall();
	}
}

window.onbeforeunload = function() {
	sendMessage('bye');
};

/////////////////////////////////////////////////////////

function createPeerConnection() {
	try {
		var pc = new RTCPeerConnection(null);
		pc.onicecandidate = handleIceCandidate;
		pc.onaddstream = handleRemoteStreamAdded;
		pc.onremovestream = handleRemoteStreamRemoved;
		console.log('Created RTCPeerConnnection');
		pcs.push(pc);
		currPc = pc;
	} catch (e) {
		console.log('Failed to create PeerConnection, exception: ' + e.message);
		alert('Cannot create RTCPeerConnection object.');
		return;
	}
}

function handleIceCandidate(event) {
	console.log('icecandidate event: ', event);
	if (event.candidate) {
		sendMessage({
			type: 'candidate',
			label: event.candidate.sdpMLineIndex,
			id: event.candidate.sdpMid,
			candidate: event.candidate.candidate
		});
	} else {
		console.log('End of candidates.');
	}
}

function handleCreateOfferError(event) {
	console.log('createOffer() error: ', event);
}

function doCall() {
	console.log('Sending offer to peer');
	currPc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
	console.log('Sending answer to peer.');
	currPc.createAnswer().then(
		setLocalAndSendMessage,
		onCreateSessionDescriptionError
	);
}

function setLocalAndSendMessage(sessionDescription) {
	currPc.setLocalDescription(sessionDescription);
	console.log('setLocalAndSendMessage sending message', sessionDescription);
	sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
	trace('Failed to create session description: ' + error.toString());
}

function requestTurn(turnURL) {
	var turnExists = false;
	for (var i in pcConfig.iceServers) {
		if (pcConfig.iceServers[i].urls.substr(0, 5) === 'turn:') {
			turnExists = true;
			turnReady = true;
			break;
		}
	}
	if (!turnExists) {
		console.log('Getting TURN server from ', turnURL);
		// No TURN server. Get one from computeengineondemand.appspot.com:
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function() {
			if (xhr.readyState === 4 && xhr.status === 200) {
				var turnServer = JSON.parse(xhr.responseText);
				console.log('Got TURN server: ', turnServer);
				pcConfig.iceServers.push({
					'urls': 'turn:' + turnServer.username + '@' + turnServer.turn,
					'credential': turnServer.password
				});
				turnReady = true;
			}
		};
		xhr.open('GET', turnURL, true);
		xhr.send();
	}
}

function handleRemoteStreamAdded(event) {
	var remoteStream = event.stream;
	if(!remoteVideo1.srcObject){
		console.log('Remote stream1 added.');
		remoteStream1 = remoteStream;
		remoteVideo1.srcObject = remoteStream;
	}else{
		console.log('Remote stream2 added.');
		remoteStream2 = remoteStream;
		remoteVideo2.srcObject = remoteStream;
	}

	hasRemote = true;
}

function handleRemoteStreamRemoved(event) {
	console.log('Remote stream removed. Event: ', event);
}

function hangup() {
	console.log('Hanging up.');
	stop();
	sendMessage('bye');
}

function handleRemoteHangup() {
	console.log('Session terminated.');
	stop();
	isInitiator = false;
}

function stop() {
	isStarted = false;
	currPc.close();
	currPc = null;
}

'use strict';

var isChannelReady = false; //socket.io channel ready
var isInitiator = false; //socket.io create room
var isStarted = false;	//local stream added
var localStream;
var remoteStream1;
var remoteStream2;
var turnReady;
let localSocketId = null
var socketArray = []; 

var pcConfig = {
	'iceServers': [{
		'urls': 'stun:stun.l.google.com:19302'
	}]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
	offerToReceiveAudio: true,
	offerToReceiveVideo: true
};

/////////////////////////////////////////////

var room = 'foo';
// Could prompt for room name:
// room = prompt('Enter room name:');

var localVideo = document.querySelector('#localVideo');
var remoteVideo1 = document.querySelector('#remoteVideo1');
var remoteVideo2 = document.querySelector('#remoteVideo2');

var socket = io.connect();

if (room !== '') {
	socket.emit('create or join', room);
	console.log('Attempted to create or  join room', room);
}

socket.on('created', function(room,id) {
	console.log('Created room ' + room);
	isInitiator = true;
	isChannelReady = true;
	
	localSocketId = id;
	getLocalStream();
});

socket.on('full', function(room) {
	console.log('Room ' + room + ' is full');
});

socket.on('join', function (room){
	console.log('Another peer made a request to join room ' + room);
});

socket.on('joined', function(room,id) {
	console.log('socketId ' + id + 'joined: ' + room);
	localSocketId = id;

	getLocalStream();
	sendMessage('got user media','all');
});

socket.on('log', function(array) {
//	console.log.apply(console, array);
});

////////////////////////////////////////////////

function sendMessage(message,toId) {
	let id = toId || 'all';
	socket.emit('message', message,localSocketId,id);
}

// This client receives a message
socket.on('message', function(message,fromId,toId) {
	if((toId != 'all') && (toId != localSocketId)){
		console.log('receive message from ' + fromId + ' to ' + toId);
		return;
	}

	var sh = getSocketArray(fromId);

	if(sh.pc && (sh.pc.connectionState == 'connected')){
		if (message === 'bye') 
			handleRemoteHangup(sh.pc);

		return;
	}

	if (message === 'got user media') {
		if(!sh.pc){
			sh.pc = maybeStart();
		}
		doCall(sh);
	} else if (message.type === 'offer') {
		console.log("receive offer from :", fromId);
		if(!sh.pc){
			sh.pc = maybeStart();
		}
		sh.pc.setRemoteDescription(new RTCSessionDescription(message));

		doAnswer(sh);
	} else if (message.type === 'answer') {
		console.log("receive answer from :", fromId);
		sh.pc.setRemoteDescription(new RTCSessionDescription(message));
	} else if (message.type === 'candidate') {
		console.log("receive candidate from :", fromId);
		if(!sh.pc){
			sh.pc = maybeStart();
		}

		var candidate = new RTCIceCandidate({
			sdpMLineIndex: message.label,
			candidate: message.candidate
		});
		sh.pc.addIceCandidate(candidate);
	}else{
		console.error("Nothing to do with: " , sh);
	}
});

////////////////////////////////////////////////////
function getLocalStream(){
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
	}
}

function getSocketArray(id){
	for(let arr of socketArray){
		if(arr.id == id){
			return arr;
		}
	}

	let tmpArr = {
		id:id,
		pc:null,
	};

	socketArray.push(tmpArr);
	return tmpArr;
}

if (location.hostname !== 'localhost') {
	requestTurn(
		'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
	);
}

function maybeStart() {
	console.log('>>>>>> maybeStart() creating peer connection');
	var pc = createPeerConnection();
	pc.addStream(localStream);
	return pc;
}

window.onbeforeunload = function() {
	sendMessage('bye');
};

/////////////////////////////////////////////////////////

function createPeerConnection() {
	var pc = new RTCPeerConnection(null);
	pc.onicecandidate = handleIceCandidate;
	pc.onaddstream = handleRemoteStreamAdded;
	pc.onremovestream = handleRemoteStreamRemoved;
	console.log('Created RTCPeerConnnection');
	return pc;
}

function handleIceCandidate(event) {
	console.log('handleIceCandidate icecandidate event: ', event);
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

function doCall(sh) {
	console.log('doCall Sending offer to peer');
	sh.pc.createOffer().then(function(offer){
		sh.pc.setLocalDescription(offer);
		console.log('doCall sending message', offer);
		sendMessage(offer,sh.id);
	}).catch(onCreateSessionDescriptionError);
}

function doAnswer(sh) {
	console.log('doAnswer Sending answer to peer.');
	sh.pc.createAnswer().then(function(answer){
		sh.pc.setLocalDescription(answer);
		console.log('doAnswer sending message', answer);
		sendMessage(answer,sh.id);
	}).catch(onCreateSessionDescriptionError);
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
}

function handleRemoteStreamRemoved(event) {
	console.log('Remote stream removed. Event: ', event);
}

function handleRemoteHangup(pc) {
	console.log('Session terminated.');
	stop(pc);
}

function stop(pc) {
	pc.close();
}

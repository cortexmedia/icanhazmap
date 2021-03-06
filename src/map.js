var WebMercator = require('./web_mercator');

var requestAnimationFrame = (
	window.requestAnimationFrame ||
	function(fn) { return setTimeout(fn, 15); }
);

var PI2 = Math.PI * 2,
	zoomRatios = [1, 16, 800],
	maxTapDuration = 500,
	tapDistanceTolerance2 = 17 * 17,
	defaultAnimationDuration = 400,
	momentumSamples = 2,
	momentumMaxSamples = 16,
	momentumDuration = 750,
	momentumTimeWindow = momentumDuration + 150,
	rotationSnapStep = Math.PI * 0.25,
	rotationSnapTolerance = Math.PI / 180 * 12,
	rotationLockDeadZone = 40,
	rotationLockTolerance = Math.PI / 180 * 8;

var kClick = 'click',
	kWheel = 'wheel',
	kDblClick = 'dblclick',
	kDragStart = 'dragstart',
	kMouseDown = 'mousedown',
	kMouseMove = 'mousemove',
	kMouseUp = 'mouseup',
	kTouchStart = 'touchstart',
	kTouchMove = 'touchmove',
	kTouchEnd = 'touchend';

module.exports = Map;
function Map(options) {
	this.onClick = this.onClick.bind(this);
	this.onWheel = this.onWheel.bind(this);
	this.onDblClick = this.onDblClick.bind(this);
	this.onDragStart = this.onDragStart.bind(this);
	this.onMouseDown = this.onMouseDown.bind(this);
	this.onMouseMove = this.onMouseMove.bind(this);
	this.onMouseUp = this.onMouseUp.bind(this);
	this.onTouchStart = this.onTouchStart.bind(this);
	this.onTouchMove = this.onTouchMove.bind(this);
	this.onTouchEnd = this.onTouchEnd.bind(this);

	this.canvas  = options.canvas || document.createElement('canvas');
	this.context = options.context || this.canvas.getContext('2d', { alpha: false });

	this.eventMap = {};
	this.minZoom   = options.minZoom || 0;
	this.maxZoom   = options.maxZoom || 18;
	this.zoom = options.zoom || 0;
	this.nominalTileSize = options.nominalTileSize || 256;
	this.maxPixelRatio = options.maxPixelRatio || 1;

	this.projection = options.projection || WebMercator;
	this.rotation   = options.rotation || 0;
	this.canRotate  = (options.canRotate !== false);
	this.normalizedCenter = options.center ? this.lngLatToNormalized(options.center) : [0, 0];
	this.normalizedBounds = !!options.maxBounds && [
		this.lngLatToNormalized(options.maxBounds[0]),
		this.lngLatToNormalized(options.maxBounds[1])
	];

	this._render = options.render || noop;
	this._resize = this.resize.bind(this, null, null);
	this._didRefresh = this.didRefresh.bind(this);
	this._renderAnimation = this._renderAnimation.bind(this);
	this._refreshing = false;
	this._rotationLocked = false;

	this.longitudeTransition = {};
	this.latitudeTransition  = {};
	this.zoomTransition      = {};
	this.rotationTransition  = {};

	this._longitudeMomentum = [];
	this._latitudeMomentum  = [];
	this._zoomMomentum      = [];
	this._rotationMomentum  = [];

	if (options.interactive !== false) {
		this.bindEvents();
	}

	window.addEventListener('resize', this._resize);
	requestAnimationFrame(this._resize);
}

Map.pickDomain = function pickDomain(x, y, z, domains) {
	return domains[(z * 211 + y * 61 + x) % domains.length];
};

Map.prototype.on = function on(eventName, callback) {
	var callbacks = this.eventMap[eventName];

	if (!callbacks) {
		this.eventMap[eventName] = [callback];
	}
	else if (callbacks.indexOf(callback) === -1) {
		callbacks.push(callback);
	}
};

Map.prototype.off = function off(eventName, callback) {
	var callbacks = this.eventMap[eventName];

	if (callbacks) {
		var index = callbacks.indexOf(callback);

		if (index !== -1) {
			callbacks.splice(index, 1);
		}
	}
};

Map.prototype._fire = function _fire(eventName, event) {
	var callbacks = this.eventMap[eventName];

	if (callbacks) {
		for (var i = 0; i < callbacks.length; ++i) {
			callbacks[i](event);
		}
	}
};

Map.prototype.destroy = function destroy() {
	this.unbindEvents();
	window.removeEventListener('resize', this._resize);
	this._render = noop;
};

Map.prototype.resize = function resize(width, height) {
	var context = this.context,
		backingStorePixelRatio = (
			context.webkitBackingStorePixelRatio ||
			context.mozBackingStorePixelRatio ||
			context.msBackingStorePixelRatio ||
			context.oBackingStorePixelRatio ||
			context.backingStorePixelRatio || 1
		);

	this.pixelRatio = Math.min(this.maxPixelRatio, (window.devicePixelRatio || 1) / backingStorePixelRatio);

	this.canvas.width  = Math.round((width  || this.canvas.clientWidth ) * this.pixelRatio);
	this.canvas.height = Math.round((height || this.canvas.clientHeight) * this.pixelRatio);

	this.render();
};

Map.prototype.render = function render() {
	this._render();
	this._fire('render');
};

Map.prototype.refresh = function refresh() {
	if (!this._refreshing) {
		this._refreshing = true;
		requestAnimationFrame(this._didRefresh);
	}
};

Map.prototype.didRefresh = function didRefresh() {
	this._refreshing = false;
	this.render();
};

Map.prototype.renderTiles = function renderTiles(layer) {
	layer.render(
		this.context,
		this.canvas.width, this.canvas.height,
		this.normalizedCenter, this.zoom, this.rotation,
		this.pixelRatio, this.nominalTileSize
	);
};

Map.prototype.resetTransform = function resetTransform() {
	this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
};

Map.prototype.getCenterLngLat = function getCenterLngLat() {
	return this.normalizedToLngLat(this.normalizedCenter);
};

Map.prototype.lngLatToClient = function lngLatToClient(lngLat) {
	return this.normalizedToClient(this.lngLatToNormalized(lngLat));
};

Map.prototype.clientToLngLat = function clientToLngLat(clientCoords) {
	return this.normalizedToLngLat(this.clientToNormalized(clientCoords));
};

Map.prototype.lngLatToNormalized = function lngLatToNormalized(lngLat) {
	return this.projection.normalize(+lngLat[0], +lngLat[1]);
};

Map.prototype.normalizedToLngLat = function normalizedToLngLat(normalizedCoords) {
	return this.projection.denormalize(+normalizedCoords[0], +normalizedCoords[1]);
};

Map.prototype.normalizedToClient = function normalizedToClient(v) {
	var scale = Math.pow(2, this.zoom) * this.nominalTileSize,
		rotateCos = Math.cos(this.rotation),
		rotateSin = Math.sin(this.rotation),
		c = this.normalizedCenter,
		x = v[0] - c[0],
		y = v[1] - c[1];

	return [
		(x * rotateCos - y * rotateSin) * scale + this.canvas.clientWidth  * 0.5,
		(x * rotateSin + y * rotateCos) * scale + this.canvas.clientHeight * 0.5
	];
};

Map.prototype.clientToNormalized = function clientToNormalized(v) {
	var scale = Math.pow(2, this.zoom) * this.nominalTileSize,
		rotateCos = Math.cos(-this.rotation),
		rotateSin = Math.sin(-this.rotation),
		c = this.normalizedCenter,
		x = v[0] - this.canvas.clientWidth  * 0.5,
		y = v[1] - this.canvas.clientHeight * 0.5;

	return [
		(x * rotateCos - y * rotateSin) / scale + c[0],
		(x * rotateSin + y * rotateCos) / scale + c[1]
	];
};

Map.prototype.clientToPolar = function clientToPolar(v) {
	return cartesianToPolar(
		v[0] - this.canvas.clientWidth  * 0.5,
		v[1] - this.canvas.clientHeight * 0.5
	);
};

Map.prototype.polarToClient = function polarToClient(v) {
	var c = polarToCartesian(v[0], v[1]);
	return [
		c[0] + this.canvas.clientWidth  * 0.5,
		c[1] + this.canvas.clientHeight * 0.5
	];
};

Map.prototype.jumpTo = function jumpTo(coords) {
	return this.panTo(coords, 0);
};

Map.prototype.panTo = function panTo(coords, duration, ease) {
	return this.panToNormalized(this.lngLatToNormalized(coords), duration, ease);
};

Map.prototype.panByXY = function panByXY(byX, byY, duration, ease) {
	this._panByXY(byX, byY, duration, ease);
	this.renderAnimation();
};

Map.prototype._panByXY = function _panByXY(byX, byY, duration, ease) {
	var scale = Math.pow(2, this.zoom) * this.nominalTileSize,
		rotateCos = Math.cos(-this.rotation),
		rotateSin = Math.sin(-this.rotation),
		deltaX = -(byX * rotateCos - byY * rotateSin) / scale,
		deltaY = -(byX * rotateSin + byY * rotateCos) / scale

	return this._panToNormalized([
		this.normalizedCenter[0] + deltaX,
		this.normalizedCenter[1] + deltaY
	], duration, ease);
};

Map.prototype.panToNormalized = function panToNormalized(normalizedCoords, duration, ease) {
	this._panToNormalized(normalizedCoords, duration, ease);
	this.renderAnimation();
};

Map.prototype._panToNormalized = function _panToNormalized(normalizedCoords, duration, ease) {
	var now = new Date().getTime();

	this.longitudeTransition = {
		startValue: this.normalizedCenter[0],
		endValue: normalizedCoords[0],
		delta: normalizedCoords[0] - this.normalizedCenter[0],
		startTime: now,
		duration: (duration != null) ? duration : defaultAnimationDuration,
		ease: ease || easeInOutCubic,
		active: true
	};

	this.latitudeTransition = {
		startValue: this.normalizedCenter[1],
		endValue: normalizedCoords[1],
		delta: normalizedCoords[1] - this.normalizedCenter[1],
		startTime: now,
		duration: (duration != null) ? duration : defaultAnimationDuration,
		ease: ease || easeInOutCubic,
		active: true
	};
};

Map.prototype._panByNormalized = function _panByNormalized(deltaCoords, duration, ease) {
	return this._panToNormalized([
		this.normalizedCenter[0] + deltaCoords[0],
		this.normalizedCenter[1] + deltaCoords[1]
	], duration, ease);
};

Map.prototype.zoomAtXY = function zoomAtXY(zoomDelta, around, duration, ease) {
	this._zoomBy(zoomDelta, duration, ease)
	this.renderAnimation();
};

Map.prototype._zoomBy = function _zoomBy(zoomDelta, duration, ease) {
	var zoom = clamp(this.zoom + zoomDelta, this.minZoom, this.maxZoom);

	this._zoomTo(zoom, duration, ease);
};

Map.prototype.setZoom = function setZoom(zoom, duration, ease) {
	this._zoomTo(zoom, duration, ease);
	this.renderAnimation();
};

Map.prototype._zoomTo = function _zoomTo(zoom, duration, ease) {
	this.zoomTransition = {
		startValue: this.zoom,
		endValue: zoom,
		delta: zoom - this.zoom,
		startTime: new Date().getTime(),
		duration: (duration != null) ? duration : defaultAnimationDuration,
		ease: ease || easeInOutCubic,
		active: true
	};
};

Map.prototype.rotate = function rotate(radians, duration, ease) {
	this._rotateBy(radians, duration, ease);
	this.renderAnimation();
};

Map.prototype._rotateBy = function _rotateBy(radians, duration, ease) {
	this.rotationTransition = {
		startValue: this.rotation,
		endValue: this.rotation + radians,
		delta: radians,
		startTime: new Date().getTime(),
		duration: (duration != null) ? duration : defaultAnimationDuration,
		ease: ease || easeInOutCubic,
		active: true
	};
};

Map.prototype.setRotation = function setRotation(radians, duration, ease) {
	this.rotationTransition = {
		startValue: this.rotation,
		endValue: radians,
		delta: wrapDelta(radians, this.rotation, PI2),
		startTime: new Date().getTime(),
		duration: (duration != null) ? duration : defaultAnimationDuration,
		ease: ease || easeInOutCubic,
		active: true
	};
	this.renderAnimation();
};

Map.prototype._clearManipulation = function _clearManipulation() {
	this._rotationLocked = null;
	this._longitudeMomentum.length = 0;
	this._latitudeMomentum.length  = 0;
	this._zoomMomentum.length      = 0;
	this._rotationMomentum.length  = 0;

	// stop transitions
	this._panByNormalized([0,0], 0);
	this._zoomBy(0, 0);
	this._rotateBy(0, 0);
}

Map.prototype._finalizeManipulation = function _finalizeManipulation() {
	// Create momentum effect by extrapolating view transitions
	var now = new Date().getTime(),
		extrapolatedTime = now + momentumDuration;

	if (!this.longitudeTransition.active && !this.latitudeTransition.active) {
		var longitudeDelta = extrapolate(extrapolatedTime, this._longitudeMomentum),
			latitudeDelta = extrapolate(extrapolatedTime, this._latitudeMomentum);

		this._panByNormalized([longitudeDelta, latitudeDelta], momentumDuration, easeOutCubic);
	}

	if (!this.zoomTransition.active) {
		var zoomDelta = extrapolate(extrapolatedTime, this._zoomMomentum);

		this._zoomBy(zoomDelta, momentumDuration, easeOutCubic);
	}

	if (!this.rotationTransition.active) {
		var rotationDelta = extrapolate(extrapolatedTime, this._rotationMomentum);

		rotationDelta += this._snapRotation(this.rotation + rotationDelta);
		this._rotateBy(rotationDelta, momentumDuration, easeOutCubic);
	}

	this._scheduleRender();

	if (this._isManipulatingCenter) {
		this._isManipulatingCenter = false;
		this._fire('moveend');
	}
}

Map.prototype._snapRotation = function _snapRotation(rotation) {
	var snapMod = wrap(rotation, rotationSnapStep);

	if (snapMod < rotationSnapTolerance) {
		return -snapMod;
	}
	else if ((rotationSnapStep - snapMod) < rotationSnapTolerance) {
		return rotationSnapStep - snapMod;
	}

	return 0;
};

Map.prototype._scheduleRender = function _scheduleRender() {
	if (this._animationFrame == null) {
		this._animationFrame = requestAnimationFrame(this._renderAnimation);
	}
};

Map.prototype._renderAnimation = function _renderAnimation() {
	this._animationFrame = null;
	this.renderAnimation();
};

Map.prototype.renderAnimation = function renderAnimation() {
	var now = new Date().getTime(),
		isMoving = false,
		isRotating = false;

	if (this.longitudeTransition.active) {
		var v = wrap(lerp(now, this.longitudeTransition), 1);

		if (this.normalizedBounds) {
			if (wrapDelta(v, this.normalizedBounds[0][0], 1) < 0) {
				v = this.normalizedBounds[0][0];
			}
			else if (wrapDelta(v, this.normalizedBounds[1][0], 1) > 0) {
				v = this.normalizedBounds[1][0];
			}
		}

		this.normalizedCenter = [v, this.normalizedCenter[1]];
		this.longitudeTransition.active = now < this.longitudeTransition.startTime + this.longitudeTransition.duration;
		isMoving = true;
	}

	if (this.latitudeTransition.active) {
		var v = wrap(lerp(now, this.latitudeTransition), 1);

		if (this.normalizedBounds) {
			if (wrapDelta(v, this.normalizedBounds[0][1], 1) > 0) {
				v = this.normalizedBounds[0][1];
			}
			else if (wrapDelta(v, this.normalizedBounds[1][1], 1) < 0) {
				v = this.normalizedBounds[1][1];
			}
		}

		this.normalizedCenter = [this.normalizedCenter[0], v];
		this.latitudeTransition.active = now < this.latitudeTransition.startTime + this.latitudeTransition.duration;
		isMoving = true;
	}

	if (this.zoomTransition.active) {
		this.zoom = lerp(now, this.zoomTransition);
		this.zoomTransition.active = now < this.zoomTransition.startTime + this.zoomTransition.duration;
	}

	if (this.rotationTransition.active) {
		var v = wrap(lerp(now, this.rotationTransition), PI2);

		isRotating = (v !== this.rotation);
		this.rotation = v;
		this.rotationTransition.active = now < this.rotationTransition.startTime + this.rotationTransition.duration;
	}

	if (
		this.longitudeTransition.active ||
		this.latitudeTransition.active ||
		this.zoomTransition.active ||
		this.rotationTransition.active
	) {
		this._scheduleRender();
	}

	this.render();

	if (isMoving) {
		this._fire('move');

		if (!this._isManipulatingCenter && !this.longitudeTransition.active && !this.latitudeTransition.active) {
			this._fire('moveend');
		}
	}

	if (isRotating) {
		this._fire('rotate');
	}
};

Map.prototype.trapRotation = function trapRotation(startPolar, currentPolar) {
	if (this._rotationLocked != null) {
		return this._rotationLocked;
	}

	var lengthDelta = currentPolar[0] - startPolar[0],
		angleDelta  = wrapDelta(startPolar[1], currentPolar[1], PI2);

	if (Math.abs(angleDelta) > rotationLockTolerance) {
		this._rotationLocked = false;
		return false;
	}
	else if (Math.abs(lengthDelta) > rotationLockDeadZone) {
		this._rotationLocked = true;
		return true;
	}

	return true;
};

Map.prototype._checkTap = function _checkTap(client) {
	if (this._tappedTime == null) {
		return;
	}

	var deltaX = client[0] - this._tappedTouch[0],
		deltaY = client[1] - this._tappedTouch[1],
		distanceSq = deltaX * deltaX + deltaY * deltaY;

	if (distanceSq > tapDistanceTolerance2) {
		return;
	}

	var now = new Date().getTime();

	return (now - this._tappedTime) < maxTapDuration;
};

Map.prototype._checkDoubleTap = function _checkDoubleTap(touches) {
	if (this._tappedTime == null || touches.length !== 1) {
		return;
	}

	var touch = eventToClient(touches[0]),
		deltaX = touch[0] - this._tappedTouch[0],
		deltaY = touch[1] - this._tappedTouch[1],
		distanceSq = deltaX * deltaX + deltaY * deltaY;

	if (distanceSq > tapDistanceTolerance2) {
		return;
	}

	var now = new Date().getTime();

	return (now - this._tappedTime) < maxTapDuration;
};

Map.prototype.manipulate = function manipulate(previousTouch0, currentTouch0, previousTouch1, currentTouch1, startTouch0, startTouch1) {
	if (currentTouch0 == null || previousTouch0 == null) {
		return;
	}

	this._isManipulatingCenter = true;

	if (previousTouch1 == null || currentTouch1 == null || startTouch0 == null || startTouch1 == null) {
		this.panByXY(
			currentTouch0[0] - previousTouch0[0],
			currentTouch0[1] - previousTouch0[1],
			0
		);

		updateMomentum(this._latitudeMomentum, this.latitudeTransition);
		updateMomentum(this._longitudeMomentum, this.longitudeTransition);

		return;
	}

	var previousCenter = [ (previousTouch0[0] + previousTouch1[0]) * 0.5, (previousTouch0[1] + previousTouch1[1]) * 0.5 ],
		currentCenter  = [ ( currentTouch0[0] +  currentTouch1[0]) * 0.5, ( currentTouch0[1] +  currentTouch1[1]) * 0.5 ];

	var startPolar = cartesianToPolar(
		startTouch0[0] - startTouch1[0],
		startTouch0[1] - startTouch1[1]
	);

	var previousPolar = cartesianToPolar(
		previousTouch0[0] - previousTouch1[0],
		previousTouch0[1] - previousTouch1[1]
	);

	var currentPolar = cartesianToPolar(
		currentTouch0[0] - currentTouch1[0],
		currentTouch0[1] - currentTouch1[1]
	);

	this._zoomBy(log2(currentPolar[0] / previousPolar[0]), 0);
	updateMomentum(this._zoomMomentum, this.zoomTransition);

	this._panByXY(
		currentCenter[0] - previousCenter[0],
		currentCenter[1] - previousCenter[1],
		0
	);
	updateMomentum(this._latitudeMomentum, this.latitudeTransition);
	updateMomentum(this._longitudeMomentum, this.longitudeTransition);

	if (this.canRotate && !this.trapRotation(startPolar, currentPolar)) {
		this._rotateBy(currentPolar[1] - previousPolar[1], 0);
		updateMomentum(this._rotationMomentum, this.rotationTransition);
	}

	this.renderAnimation();
};

Map.prototype.bindEvents = function bindEvents() {
	var element = this.canvas;
	element.addEventListener(kClick, this.onClick);
	element.addEventListener(kDragStart, this.onDragStart);
	element.addEventListener(kWheel, this.onWheel);
	element.addEventListener(kDblClick, this.onDblClick);
	element.addEventListener(kMouseDown, this.onMouseDown);
	element.addEventListener(kMouseMove, this.onMouseMove);
	element.addEventListener(kMouseUp, this.onMouseUp);
	element.addEventListener(kTouchStart, this.onTouchStart);
	element.addEventListener(kTouchMove, this.onTouchMove);
	element.addEventListener(kTouchEnd, this.onTouchEnd);
};

Map.prototype.unbindEvents = function unbindEvents() {
	var element = this.canvas;
	element.removeEventListener(kClick, this.onClick);
	element.removeEventListener(kDragStart, this.onDragStart);
	element.removeEventListener(kWheel, this.onWheel);
	element.removeEventListener(kDblClick, this.onDblClick);
	element.removeEventListener(kMouseDown, this.onMouseDown);
	element.removeEventListener(kMouseMove, this.onMouseMove);
	element.removeEventListener(kMouseUp, this.onMouseUp);
	element.removeEventListener(kTouchStart, this.onTouchStart);
	element.removeEventListener(kTouchMove, this.onTouchMove);
	element.removeEventListener(kTouchEnd, this.onTouchEnd);
};

Map.prototype.onClick = function onClick(event) {
	event.preventDefault();

	var client = eventToClient(event);

	if (this._checkTap(client)) {
		var lngLat = this.clientToLngLat(client);
		this._fire('click', {lngLat: lngLat});
	}
};

Map.prototype.onDragStart = function onDragStart(event) {
	event.preventDefault();
};

Map.prototype.onWheel = function onWheel(event) {
	event.preventDefault();

	var ratio = zoomRatios[event.deltaMode] || 1,
		duration = (!event.deltaMode ? 0 : defaultAnimationDuration);

	this.zoomAtXY(event.deltaY * ratio * -0.005, eventToClient(event), duration);
};

Map.prototype.onDblClick = function onDblClick(event) {
	event.preventDefault();
	this.zoomAtXY(
		(event.altKey || event.shiftKey) ? -1 : 1,
		eventToClient(event)
	);
};

Map.prototype.onMouseDown = function onMouseDown(event) {
	event.preventDefault();
	this._previousMouse = this._startMouse = eventToClient(event);
	this._tappedTime = new Date().getTime();
	this._tappedTouch = this._startMouse;
	this._clearManipulation();
};

Map.prototype.onMouseMove = function onMouseMove(event) {
	var current = eventToClient(event);

	event.preventDefault();

	if (this._previousMouse != null) {
		if (event.buttons === 1 && !event.altKey) {
			this._isManipulatingCenter = true;
			this.panByXY(
				current[0] - this._previousMouse[0],
				current[1] - this._previousMouse[1],
				0
			);
			updateMomentum(this._latitudeMomentum, this.latitudeTransition);
			updateMomentum(this._longitudeMomentum, this.longitudeTransition);
		}
		else if ((event.buttons === 1 && event.altKey) || event.buttons === 4) {
			// var startPolar    = this.clientToPolar(this._startMouse),
			var previousPolar = this.clientToPolar(this._previousMouse),
				currentPolar  = this.clientToPolar(current);

			this._zoomBy(log2(currentPolar[0] / previousPolar[0]), 0);
			updateMomentum(this._zoomMomentum, this.zoomTransition);

			// if (!this.trapRotation(startPolar, currentPolar)) {
			// 	rotation += currentPolar[1] - previousPolar[1];
			// }

			if (this.canRotate) {
				this._rotateBy(currentPolar[1] - previousPolar[1], 0);
				updateMomentum(this._rotationMomentum, this.rotationTransition);
			}

			this.renderAnimation();
		}
	}

	this._previousMouse = current;
};

Map.prototype.onMouseUp = function onMouseUp(event) {
	event.preventDefault();
	this._previousMouse = null;
	this._finalizeManipulation();
};

Map.prototype.onTouchStart = function onTouchStart(event) {
	event.preventDefault();

	var touch0 = event.touches[0],
		touch1 = event.touches[1];

	this._previousTouch0 = this._startTouch0 = touch0 && eventToClient(touch0);
	this._previousTouch1 = this._startTouch1 = touch1 && eventToClient(touch1);
	this._clearManipulation();

	if (this._checkDoubleTap(event.touches)) {
		this._tappedTime = null;
		this.onDblTap(event);
	}
	else {
		this._tappedTime = new Date().getTime();
		this._tappedTouch = this._startTouch0;
	}
};

Map.prototype.onDblTap = function onDblTap(event) {
	event.preventDefault();
	this.zoomAtXY(1, eventToClient(event.touches[0]));
};

Map.prototype.onTouchMove = function onTouchMove(event) {
	event.preventDefault();

	var touch0 = event.touches[0],
		touch1 = event.touches[1],
		currentTouch0 = touch0 && eventToClient(touch0),
		currentTouch1 = touch1 && eventToClient(touch1);

	if (this._tappedTime != null && !this._checkDoubleTap(event.touches)) {
		this._tappedTime = null;
	}

	if (currentTouch0 && this._previousTouch0) {
		this.manipulate(
			this._previousTouch0, currentTouch0,
			this._previousTouch1, currentTouch1,
			this._startTouch0, this._startTouch1
		);
	}

	this._previousTouch0 = currentTouch0;
	this._previousTouch1 = currentTouch1;
};

Map.prototype.onTouchEnd = function onTouchEnd(event) {
	event.preventDefault();

	this._previousTouch0 = this._previousTouch1 = null;
	this._finalizeManipulation();

	var client = eventToClient(event.changedTouches[0]);

	if (event.touches.length === 0 && this._checkTap(client)) {
		var lngLat = this.clientToLngLat(client);

		this._fire('click', {lngLat: lngLat});
	}
};

function noop() {}

function updateMomentum(momentum, transition) {
	if (momentum.length >= momentumMaxSamples*2) {
		momentum.splice(0, 2);
	}

	momentum.push(transition.startTime, transition.delta);
}

function lerp(now, transition) {
	var duration = transition.duration,
		elapsed = now - transition.startTime;

	if (!duration || elapsed >= duration) {
		return transition.endValue;
	}

	return transition.ease(elapsed / duration) * transition.delta + transition.startValue;
}

// extrapolate a value based on the time series array of [time, v] pairs
function extrapolate(endTime, momentum) {
	var sum = 0, n = 0,
		firstTime = 0,
		lastTime = 0;

	for (var i = 1; i < momentum.length; i += 2) {
		var t = momentum[i-1], v = momentum[i];

		if (t < endTime - momentumTimeWindow) {
			continue;
		}

		if (!firstTime) {
			firstTime = t;
		}

		lastTime = t;
		sum += v;
		++n;
	}

	if (n < momentumSamples || lastTime === firstTime) {
		return 0;
	}

	return sum / n / (lastTime - firstTime) * (endTime - lastTime);
}

function easeInOutCubic(t) {
	t *= 2;
	if (t < 1) return 0.5*t*t*t;
	t -= 2;
	return 0.5*(t*t*t + 2);
}

function easeOutCubic(t) {
	t--;
	return t*t*t + 1;
}

function clamp(x, min, max) {
	return (
		(x < min) ?
			min
		: (x > max) ?
			max
		:
			x
	);
}

function log2(x) {
	return Math.log(x) / Math.LN2;
}

function wrap(x, bound) {
	return (((x) % bound) + bound) % bound;
}

function wrapDelta(a, b, bound) {
	var halfBound = 0.5 * bound;
	return wrap(a - b + halfBound, bound) - halfBound;
}

function cartesianToPolar(x, y) {
	return [
		Math.sqrt((x * x) + (y * y)),
		Math.atan2(y, x)
	];
}

function polarToCartesian(length, angle) {
	return [
		Math.cos(angle) * length,
		Math.sin(angle) * length
	];
}

function eventToClient(event) {
	var bounds = event.target.getBoundingClientRect();

	return [
		event.clientX - bounds.left,
		event.clientY - bounds.top
	];
}

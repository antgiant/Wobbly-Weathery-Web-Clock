import { conf } from './config.js';

// elements that ouput our position
var directionDiv = document.getElementById("compass-direction");

// called on device orientation change
function onHeadingChange(event) {
    var heading = -1 * event.webkitCompassHeading || event.alpha;
    
    if (typeof heading !== "undefined" && heading !== null) {
        heading = heading - window.orientation;
        
        if (heading < 0) {
            heading = (-heading | 0);
        } else {
            heading = (360 - heading | 0)
        }
        //reduce write frequency to localstorage
        if (Math.abs(heading - conf.location_heading) >= 1) {
            conf.location_heading = heading;
        }
    }
    
    directionDiv.textContent = conf.location_heading + "°";
}

function requestDeviceOrientation(callback) {
    if (window.DeviceOrientationEvent == null) {
        callback(new Error("DeviceOrientation is not supported."));
    } else if (DeviceOrientationEvent.requestPermission) {
        DeviceOrientationEvent.requestPermission().then(function(state) {
            if (state == "granted") {
                callback(null);
            } else callback(new Error("Permission denied by user"));
        }, function(err) {
            callback(err);
        });
    } else { // no need for permission
        callback(null);
    }
}

function firstClick() {
    requestDeviceOrientation(function(err) {
        if (err == null) {
            window.removeEventListener("click", firstClick);
            window.removeEventListener("touchend", firstClick);
            window.addEventListener("devicelmotion", function(e) {
                // access e.acceleration, etc.
            });
        } else {
            // failed; a JS error object is stored in `err`
        }
    });
}

function updateCompassStatus() {
    if (conf.compassDirection) {
        window.addEventListener("click", firstClick);
        window.addEventListener("touchend", firstClick);
        
        if ('ondeviceorientationabsolute' in window) {
            window.addEventListener("deviceorientationabsolute", onHeadingChange, true);
        } else {
            window.addEventListener("deviceorientation", onHeadingChange, true);
        }
        document.getElementById('manualCompass').disabled = true;
    } else {
        window.removeEventListener("click", firstClick);
        window.removeEventListener("touchend", firstClick);
        window.removeEventListener("deviceorientationabsolute", onHeadingChange, true);
        window.removeEventListener("deviceorientation", onHeadingChange, true);
        document.getElementById('manualCompass').disabled = false;
    }
    directionDiv.textContent = conf.location_heading + "°";
}

function initalize() {
    
    document.getElementById("compassDirection").checked = conf.compassDirection;
    
    
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('compassDirection').addEventListener('change', (event) => {
            conf.compassDirection = event.target.checked;
            updateCompassStatus();
        });
    });
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('manualCompass').addEventListener('click', (event) => {
            conf.location_heading = Math.min(360, Math.max(0, parseFloat(prompt("Please enter your compass heading", conf.location_heading)))) || 0;
            updateCompassStatus();
        });
    });
    updateCompassStatus();
}
initalize();
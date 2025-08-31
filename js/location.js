import Virgo from './virgo/virgo.js';
import { conf } from './config.js';

let locationRefresh;

function refreshLocation() {
  if (conf.preciseLocation && ('geolocation' in navigator)) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        conf.location_latitude = pos.coords.latitude;
        conf.location_longitude = pos.coords.longitude;
        conf.location_accuracy = pos.coords.accuracy;
        conf.location_altitude = pos.coords.altitude;
        conf.location_altitudeAccuracy = pos.coords.altitudeAccuracy;
        conf.location_heading = pos.coords.heading;
      },
      (err) => {
        console.log(`GPS error: ${err.message}`);
        if (err.code == err.PERMISSION_DENIED) {
          //fallback to general location
          let temp = Virgo.getLocation();
          conf.location_latitude = temp.latitude;
          conf.location_longitude = temp.longitude;
          
          //turn off precise
          conf.preciseLocation = false;
          document.getElementById("preciseLocation").checked = conf.preciseLocation;
        }
      },
      {
        enableHighAccuracy: true, // try GPS when available
        timeout: 10000,
        maximumAge: 0
      }
    )
  } else {
    let temp = Virgo.getLocation();
    conf.location_latitude = temp.latitude;
    conf.location_longitude = temp.longitude;
  }
  clearInterval(locationRefresh);
  if (conf.gpsFrequency > 0) {
    locationRefresh = setInterval(refreshLocation, conf.gpsFrequency * 60000);
  }
}

function initalize() {
  //Set up config option actions
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('gpsFrequency').addEventListener('change', (event) => {
      conf.gpsFrequency = event.target.options[event.target.selectedIndex].value;
      refreshLocation();
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('preciseLocation').addEventListener('change', (event) => {
      conf.preciseLocation = event.target.checked;
      refreshLocation();
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('compassDirection').addEventListener('change', (event) => {
      conf.compassDirection = event.target.checked;
      refreshLocation();
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('refreshLocation').addEventListener('click', (event) => {
      refreshLocation();
    });
  });
  
  
  //Set up initial config settings state
  document.getElementById("preciseLocation").checked = conf.preciseLocation;
  
  document.getElementById("compassDirection").checked = conf.compassDirection;
  
  document.getElementById('gpsFrequency').value = conf.gpsFrequency;
  
  //Remove precise location option if it isn't supported
  if (!('geolocation' in navigator)) {
    console.log('Geolocation not supported.');
    conf.preciseLocation = false;
    document.getElementById("preciseLocation").style.display = 'none';
  }
  
  refreshLocation();
}

initalize();
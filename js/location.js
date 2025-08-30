import Virgo from './virgo/virgo.js';
import { conf } from './config.js';

function refreshLocation() {
  let temp = Virgo.getLocation();
  conf.location.latitude = temp.latitude;
  conf.location.longitude = temp.longitude;
  console.log(conf.location);
}

function initalize() {
  //Set up config option actions
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('gpsFrequency').addEventListener('change', (event) => {
      conf.gpsFrequency = event.target.options[event.target.selectedIndex].value;
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('preciseLocation').addEventListener('change', (event) => {
      conf.preciseLocation = event.target.checked;
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('compassDirection').addEventListener('change', (event) => {
      conf.compassDirection = event.target.checked;
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
  
}

initalize();
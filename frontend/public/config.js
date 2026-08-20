// By default the API uses the same hostname as the page, avoiding cookie
// problems between aliases such as localhost and 127.0.0.1. A generated WAR
// can still replace this file when the backend truly lives on another host.
window.PI_WEB_CONFIG = {
  apiBaseUrl: window.location.protocol + "//" + window.location.hostname + ":30142"
};

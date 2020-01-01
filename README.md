## FreeCharger OCPP EV Charging (Server)

This repository contains a Node.js implementation of a Central System (CSMS) for EV charging that communicates with charge points via OCPP. It includes:

- WebSocket OCPP 1.6-like handler: `index.js`
- SOAP OCPP 1.5 CentralSystemService: `SOAP/index.js` and `SOAP/soap.js`
- WSDL for the SOAP service: `SOAP/ocpp_centralsystemservice_1.5_final.wsdl`
- Utility shell scripts for local SSH port forwarding: `forward*.sh`

The code uses MySQL for persistence and integrates with an SMS gateway for event notifications. Sensitive values have been replaced with safe placeholders.

### Requirements
- Node.js 16+ and npm
- MySQL 5.7+/8+

### Install dependencies
```bash
npm install mysql request moment json-query websocket strong-soap ocpp-js
```

If you add a `package.json`, include the packages above as dependencies.

### Configure database and SMS
The repository currently uses inline placeholders. Before running in any environment, configure via environment variables or a config file (recommended):

- DB: host, user, password, database, port
- SMS: base URL and API token

Example env (recommended approach you can add):
```bash
export DB_HOST=localhost
export DB_USER=evuser_demo
export DB_PASSWORD=EVpointDev!9f2A
export DB_NAME=ev_points_demo
export DB_PORT=3306
export SMS_BASE_URL=https://smsapi.com
export SMS_TOKEN=REDACTED_DEMO_TOKEN
```

Then wire these into the code or a small config module (not included by default).

### Running the WebSocket server (OCPP over WS)
The WS server in `index.js` listens on 127.0.0.1 and port 8081 by default in this repo layout.
```bash
node index.js
```

For remote access you can use the provided SSH helper scripts (optional):
```bash
./forward.sh      # forwards localhost:8080 -> 127.0.0.1:8081
./forward2.sh     # forwards localhost:8082 -> 127.0.0.1:8083
./forward_mysql.sh# example MySQL forward (commented inside)
```

### Running the SOAP CentralSystemService (OCPP 1.5)
The SOAP server in `SOAP/index.js` binds to 127.0.0.1 and port 8083 and exposes `CentralSystemService` using the included WSDL.
```bash
cd SOAP
node index.js
```

The service endpoint address inside the WSDL (`SOAP/ocpp_centralsystemservice_1.5_final.wsdl`) is set to localhost for safety. Adjust it as needed for your deployment.

### Database schema
The code references several tables (anonymized names shown here). Ensure you create an equivalent schema in your database before running:

- `ev_points` (charging points registry, status, metadata)
- `boot_notification_log` (boot notifications)
- `authorize_log` (RFID authorize audit log)
- `available_cards`, `consumer_details` (RFID to consumer mapping and balances)
- `ev_sessions`, `session_log`, `missed_sessions` (session lifecycle and telemetry)
- `consumer_trasnactions` (typo preserved from original code)
- `site_settings` (key/value configuration like pricing)
- `machine_connections` (online/offline tracking)

These names are present in the source; you can rename in your own fork if you also update the queries accordingly.

### Notes
- The current code performs minimal validation and error handling; harden before production.
- Secrets should be provided via environment variables or a secrets manager, not in code.
- SMS sending is best-effort; integrate retries/webhooks as needed.

### License
This project is licensed under the GNU General Public License v2.0 (GPL-2.0). See `LICENSE` for details.



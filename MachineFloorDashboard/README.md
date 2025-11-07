# Machine Floor Dashboard

This lightweight dashboard consumes the `GetMachineFloorScreenData` stored procedure (via the existing Express backend) to visualise machine utilisation in real time.

## Prerequisites

- Backend server from `backend/` running with access to the target SQL Server and the `GetMachineFloorScreenData` stored procedure.
- Environment variable `DB_NAME_KOL`/`DB_NAME_AHM` configured so the API can select the correct database.

## Usage

1. Start the backend (from `backend/`):
   ```bash
   npm install
   npm run start
   ```
2. Open `MachineFloorDashboard/index.html` in a browser (or serve the directory with any static file server).
3. Enter the target machine ID in the **Machine** field in the header and click **Refresh**. You can still pre-populate the field by opening `index.html/58` if you want a default.
4. Leave **Auto refresh** enabled to keep the view in sync (defaults to 5 minutes). While idle, the timer increments every minute using the last known `IdleSinceMinutes` value.

## Configuration

Adjust `MachineFloorDashboard/config.js` if you need to point at a different API host, change the fallback machine ID/database (used when the URL lacks parameters), or tweak the auto refresh interval.



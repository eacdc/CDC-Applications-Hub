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
3. Provide the machine ID by appending it to the URL, e.g. `index.html/58` (optionally `index.html/58?database=KOL`). The page fetches `/api/machine-floor/{machineId}` and renders either an idle or running layout without additional user input.
4. Leave **Auto refresh** enabled to keep the view in sync (defaults to 60 seconds). While idle, the timer increments every minute using the last known `IdleSinceMinutes` value.

## Configuration

Adjust `MachineFloorDashboard/config.js` if you need to point at a different API host, change the fallback machine ID/database (used when the URL lacks parameters), or tweak the auto refresh interval.



# How to Restart the Backend

## Quick Steps:

1. **Stop the current backend:**
   - Press `Ctrl+C` in the terminal where `npm run dev` is running
   - OR kill the process: `taskkill /F /PID 62540`

2. **Start the backend again:**
   ```bash
   cd backend
   npm run dev
   ```

3. **Verify it's running:**
   - Check the terminal for "Server running on port 3000"
   - Test: http://localhost:3000/health

## Why restart is needed?
The OKX OI changes were made to the code, but the running Node.js process has the old code in memory. Restarting picks up the new changes.

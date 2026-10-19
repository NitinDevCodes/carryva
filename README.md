# Carryva

Carryva is an Express and EJS application backed by MongoDB through Mongoose.

## Requirements

- Node.js 18 or newer
- MongoDB running locally, or a MongoDB connection URI

## Setup

1. Install dependencies with `npm install`.
2. Create a `.env` file in the project root. Configure:

   ```dotenv
   PORT=3000
   MONGODB_URI=mongodb://127.0.0.1:27017
   JWT_KEY=replace-with-at-least-32-random-characters
   EXPRESS_SESSION_SECRET=replace-with-another-32-random-characters
   ```

   `MONGODB_URI` may be omitted to use `config/development.json`. The app
   connects to the `carryva` database on that MongoDB server.
3. Start the server with `npm start` and open <http://localhost:3000>.

For development with automatic restarts, run `npm run dev`.

Run the authentication integration suite with `npm test`. It uses a separate
local MongoDB database named for the test process and drops that database when
the test run finishes. Passwords must contain 8 to 72 UTF-8 bytes because the
current bcrypt implementation truncates longer inputs.

The home page and owner admin pages can render without MongoDB. Product,
registration, and login operations need a reachable MongoDB instance.

## Owner access

All registrations create customer accounts. To configure an owner, first
register the account through Carryva, then run
`npm run owner:promote -- owner@example.com` from a trusted machine with access
to the configured MongoDB database. This command changes the existing account
role directly in MongoDB; there is no public role-promotion endpoint. Owners
sign in through `/owners/login` using their existing account credentials.

Owners can manage the product catalog at `/owners/admin`. Product images are
limited to JPEG, PNG, and WebP files up to 5 MB.

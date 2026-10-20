 <div align="center">

# <em> C a r r y v a </em>

**A premium handbag shopping experience.**

A full-stack e-commerce portfolio project built for modern bag shopping.

<br>

<img src="https://img.shields.io/badge/NODE.JS-38BDF8?style=for-the-badge&logo=nodedotjs&logoColor=black" alt="Node.js">
<img src="https://img.shields.io/badge/EXPRESS-38BDF8?style=for-the-badge&logo=express&logoColor=black" alt="Express">
<img src="https://img.shields.io/badge/MONGODB-38BDF8?style=for-the-badge&logo=mongodb&logoColor=black" alt="MongoDB">
<img src="https://img.shields.io/badge/EJS-38BDF8?style=for-the-badge&logo=ejs&logoColor=black" alt="EJS">

</div>

---



## Screenshots

### Homepage
![Carryva Homepage](docs/screenshots/homepage.png)

### Shop
![Shop Page](docs/screenshots/shop.png)

### Product Details
![Product Details](docs/screenshots/product-details.png)

### Shopping Cart
![Shopping Cart](docs/screenshots/cart.png)

## Features

- **Product Catalog:** Browse bags, explore featured products, and view detailed product information.
- **Authentication:** Customer registration, login, and session management.
- **Cart Management:** Persistent carts with server-side price and stock validation.
- **Checkout & Orders:** Cash-on-delivery checkout, order history, and order management.
- **Owner Dashboard:** Manage products and update order fulfilment status.
- **Security:** Input validation, rate limiting, secure cookies, and security headers.
- **Deployment Readiness:** Health checks and MongoDB transaction support.

## Tech Stack

- **Backend:** Node.js, Express.js
- **Frontend:** EJS, CSS, JavaScript
- **Database:** MongoDB, Mongoose
- **Authentication:** JWT and Express sessions
- **Testing:** Node.js test runner and integration tests
- **Deployment:** Vercel and MongoDB Atlas

## Local Setup

**Requirements:** Node.js 20+ and MongoDB configured as a replica set.

**1. Clone the repository**

```bash
git clone https://github.com/NitinDevCodes/carryva.git
cd carryva
```

**2. Install dependencies**

```bash
npm ci
```

**3. Configure environment variables**

Copy `.env.example` to `.env` and configure:

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=carryva-rs
MONGODB_DB=Carryva
JWT_KEY=your_random_secret
EXPRESS_SESSION_SECRET=your_other_random_secret
```

Generate two distinct random secrets of at least 32 bytes. Keep `.env` private and never commit real credentials.

Configure and initialize your local MongoDB replica set before using transactional checkout and cancellation.

**4. Start the application**

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

Run the test suite:

```bash
npm test
```

Transaction tests require a disposable MongoDB replica set. Configure `CARRYVA_TEST_MONGODB_URI` as described in the test documentation.

## Deployment

Carryva is configured for production deployment with MongoDB Atlas.

Configure the following environment variables in your hosting provider:

- `NODE_ENV`
- `MONGODB_URI`
- `MONGODB_DB`
- `JWT_KEY`
- `EXPRESS_SESSION_SECRET`

Use HTTPS, secure database credentials, and appropriate trusted proxy settings.

**Health endpoints**

- `/health/live` — application liveness.
- `/health/ready` — database readiness and transaction support.

## Project Status

A portfolio project demonstrating full-stack e-commerce development, authentication, database transactions, cart management, and deployment practices. Further refinements may be needed.

## License

Available for educational and portfolio purposes.

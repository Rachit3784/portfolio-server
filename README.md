# Rachit Portfolio Central Server

Standalone Express + Socket.io + WebRTC Signaling + MongoDB Server for Rachit Gupta's Portfolio & Super Admin Portal.

## Deployment on Render / Railway / Heroku

1. Push this repository to GitHub.
2. Create a new **Web Service** on [Render.com](https://render.com) or [Railway.app](https://railway.app).
3. Connect your GitHub repository.
4. Set Build Command: `npm install`
5. Set Start Command: `npm start`
6. Add Environment Variables:
   - `PORT`: `5000` (or left blank, Render assigns $PORT automatically)
   - `MONGODB_URI`: `mongodb+srv://grachit736:<db_password>@cluster0.ufdqxzb.mongodb.net/portfoliodb?retryWrites=true&w=majority`
   - `ADMIN_EMAIL`: `grachit736@gmail.com`
   - `ADMIN_PASSWORD`: `your_admin_password`
   - `JWT_SECRET`: `your_jwt_secret`

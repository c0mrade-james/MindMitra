# MindMitra

AI Powered Digital Mental Health Platform for Higher Education Institutions

## Overview

MindMitra is a full-stack mental health platform connecting students with counselors through video consultations, AI-powered chat support, appointment scheduling, and crisis intervention resources.

## Features

- **Video Consultations** - WebRTC-based 1:1 video sessions between students and counselors
- **AI Mental Health Assistant** - Gemini-powered chat with crisis detection and counselor booking triggers
- **Appointment Management** - Booking, rescheduling, cancellation, ratings
- **Resource Library** - Articles, videos, self-help materials
- **Mood Tracking & Journaling** - Student self-monitoring tools
- **Counselor Dashboard** - Appointments, notes, student history
- **Admin Panel** - User management, analytics, emergency alerts
- **Volunteer Moderation** - Community forum moderation queue

## Tech Stack

### Frontend
- React 19 + Vite
- React Router v7
- Socket.io Client (WebRTC signaling)
- Tailwind CSS + DaisyUI
- React Hook Form + Zod

### Backend
- Node.js + Express
- MongoDB + Mongoose
- Socket.io (WebRTC signaling relay)
- JWT Authentication (Access + Refresh tokens)
- Google Generative AI (Gemini)

## Repository Structure

```
MindMitra/
├── frontend/          # React + Vite application
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── contexts/      # React contexts (Auth, Socket, Theme)
│   │   ├── hooks/         # Custom React hooks
│   │   ├── layouts/       # Page layouts
│   │   ├── pages/         # Page components
│   │   │   ├── admin/     # Admin dashboard pages
│   │   │   ├── auth/      # Authentication pages
│   │   │   ├── counselor/ # Counselor dashboard
│   │   │   ├── session/   # WebRTC video session (fixed race condition)
│   │   │   ├── student/   # Student dashboard
│   │   │   └── volunteer/ # Volunteer moderation
│   │   └── services/      # API clients
│   └── package.json
└── backend/           # Node/Express API
    ├── src/
    │   ├── config/        # Environment, DB, CORS, Cloudinary
    │   ├── controllers/   # Request handlers
    │   ├── middlewares/   # Auth, rate limiting, error handling
    │   ├── models/        # Mongoose models
    │   ├── routes/        # API route definitions
    │   ├── services/      # Business logic (email, chat, cloudinary)
    │   ├── socket/        # WebRTC signaling (fixed handleAnswer, peer-left)
    │   ├── utils/         # Helpers, constants, logger
    │   ├── app.js         # Express app setup
    │   └── server.js      # HTTP + Socket.io server
    └── package.json
```

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Optional: Cloudinary, Resend, Gemini API keys

### Backend
```bash
cd backend
cp .env.example .env  # Configure required variables
npm install
npm run dev           # Starts on http://localhost:5000
```

### Frontend
```bash
cd frontend
npm install
npm run dev           # Starts on http://localhost:5173
```

### Environment Variables (Backend)
Required:
- `MONGO_URI` - MongoDB connection string
- `ACCESS_TOKEN_SECRET` - JWT access token secret
- `REFRESH_TOKEN_SECRET` - JWT refresh token secret

Optional (services work without them for local dev):
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` - Image uploads
- `EMAIL_API_KEY` (Resend) - Email notifications
- `GEMINI_API_KEY` - AI chat assistant

## WebRTC Session Fix

**Issue:** Users saw their own face in the remote video during video consultations.

**Root Cause:** Race condition in peer connection initialization - multiple `getUserMedia()` calls creating duplicate peer connections, plus `handleAnswer` missing `fromUserId` from backend signaling payload.

**Fix Applied** (`frontend/src/pages/session/SessionPage.jsx`):
- Deduplicated peer connection initialization via `initPeerConnection` guard
- Fixed `handleAnswer` to properly destructure `{ fromUserId, answer }`
- Added connection state monitoring with automatic ICE restart on failure
- Wrapped all callbacks in `useCallback` with correct dependencies
- Added peer-left handling for graceful reconnection
- ICE servers now configurable from backend
- Local stream reuse on reconnect to avoid re-prompting camera permission

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/auth/register` | Register new user |
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/refresh` | Refresh access token |
| `GET` | `/api/v1/appointments` | List appointments |
| `POST` | `/api/v1/appointments` | Create appointment |
| `PATCH` | `/api/v1/appointments/:id` | Update appointment |
| `POST` | `/api/v1/appointments/:id/start` | Start video session |
| `GET` | `/api/v1/appointments/session/:sessionId` | Get session details |
| `GET` | `/api/v1/chat` | AI chat assistant |
| `GET` | `/api/v1/resources` | List resources |
| `POST` | `/api/v1/resources` | Upload resource |

## License

MIT
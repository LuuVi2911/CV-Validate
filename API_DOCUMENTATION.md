# API Documentation

This document outlines the available API endpoints for the CV Enhancer backend.

## Authentication (`/auth`)

These endpoints handle user registration, login, and session management.

### Register

- **Endpoint**: `POST /auth/register`
- **Body**: `{ email, password, ... }`
- **Description**: Registers a new user.

### Login

- **Endpoint**: `POST /auth/login`
- **Body**: `{ email, password }`
- **Description**: Authenticates a user and sets `accessToken` and `refreshToken` cookies.

### Get Current User

- **Endpoint**: `GET /auth/me`
- **Headers**: `Authorization: Bearer <token>`
- **Description**: Returns the profile of the currently logged-in user.

### Refresh Token

- **Endpoint**: `POST /auth/refresh`
- **Description**: Refreshes the access token using the refresh token cookie.

### Logout

- **Endpoint**: `POST /auth/logout`
- **Description**: Logs out the user and clears authentication cookies.

### Password Management

- **Forgot Password**: `POST /auth/forgot-password`
- **Reset Password**: `POST /auth/reset-password`
- **Verify Email**: `POST /auth/verify-email`

---

## Evaluation (`/evaluation`)

These endpoints are used to manage and run CV-JD evaluations.

### Run Evaluation

- **Endpoint**: `POST /evaluation/run`
- **Headers**: `Authorization: Bearer <token>`
- **Body**: `{ cvId: string, jdId: string }`
- **Description**: Triggers the evaluation process for a specific CV and JD pair. Returns immediate results or a job ID.

### List Evaluations

- **Endpoint**: `GET /evaluation/list`
- **Headers**: `Authorization: Bearer <token>`
- **Description**: Retrieves a list of past evaluations for the current user.

### Get Evaluation Summary

- **Endpoint**: `GET /evaluation/:id/summary`
- **Headers**: `Authorization: Bearer <token>`
- **Description**: Retrieves the detailed summary result of a specific evaluation.

### Delete Evaluation

- **Endpoint**: `DELETE /evaluation/:id`
- **Headers**: `Authorization: Bearer <token>`
- **Description**: Deletes a specific evaluation record.

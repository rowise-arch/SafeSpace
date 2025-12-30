# Prompt for a Context Diagram of the SafeSpace Platform

## System Description

The **SafeSpace Platform** is a web-based application designed to connect students with counselors for mental health support. The platform provides separate interfaces for students, counselors, and administrators, and it integrates with external services for notifications and authentication.

## Core Components

- **Central System:** "SafeSpace Platform"
- **Actors:**
    - **Student:** The primary user of the platform seeking counseling and resources.
    - **Counselor:** A registered professional providing counseling services.
    - **Administrator:** A system manager responsible for platform oversight.
- **External Systems:**
    - **Firebase:** Used for sending push notifications to users.
    - **SMTP Server:** Used for sending 2-factor authentication (2FA) emails.

## Data Flows

### Student -> SafeSpace Platform
-   Login/Logout Credentials
-   Profile Information (create, update)
-   Appointment Requests
-   Messages to Counselors
-   Assessment Submissions

### SafeSpace Platform -> Student
-   Profile Data
-   Appointment Confirmations/Reminders
-   Messages from Counselors
-   Mental Health Resources
-   Psychological Test Results

### Counselor -> SafeSpace Platform
-   Login/Logout Credentials (including 2FA codes)
-   Profile Information (create, update)
-   Appointment Availability
-   Messages to Students
-   Session Notes

### SafeSpace Platform -> Counselor
-   Student Profiles
-   Appointment Schedules
-   Messages from Students
-   Account Verification Emails (via SMTP)

### Administrator -> SafeSpace Platform
-   Login/Logout Credentials
-   User Management Actions (create, suspend, delete accounts)
-   Content Management Actions (update resources, tests)
-   Report Generation Requests

### SafeSpace Platform -> Administrator
-   System Dashboards
-   User Activity Reports
-   Session Logs
-   Content Previews

### SafeSpace Platform -> External Systems
-   **To Firebase:** Push Notification requests (e.g., new message, appointment reminder).
-   **To SMTP Server:** 2-Factor Authentication email requests for counselors.

## Diagram Request

Please create a **Level 0 Context Diagram** for the "SafeSpace Platform." The diagram should illustrate:
1.  The "SafeSpace Platform" as a single, central process.
2.  All external actors: **Student**, **Counselor**, and **Administrator**.
3.  All external systems: **Firebase** and **SMTP Server**.
4.  Labeled arrows representing the key data flows between the external entities and the central system, as described above.

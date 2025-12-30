## Use Case Diagram Prompt for SafeSpace Web Platform

**Objective:** Create a comprehensive use case diagram for the SafeSpace web platform.

**System Boundary:** The system is the SafeSpace web platform, which includes the student portal, counselor portal, and admin portal.

**Actors:**

*   **Student:** A registered user seeking counseling services.
*   **Counselor:** A registered professional providing counseling services.
*   **Administrator:** A user responsible for managing the SafeSpace platform.

**Use Cases:**

**Student Use Cases:**

*   **Manage Account:**
    *   Sign up for an account.
    *   Log in to the system.
    *   Log out of the system.
    *   Complete and update their profile.
    *   Manage account settings.
*   **Manage Appointments:**
    *   Schedule an appointment with a counselor.
    *   View upcoming and past appointments.
    *   Reschedule an existing appointment.
    *   Cancel an appointment.
*   **Communication:**
    *   Send and receive messages from counselors.
*   **Resources and Assessments:**
    *   Access and view available resources.
    *   Take psychological assessments.
*   **Notifications:**
    *   Receive notifications about appointments and messages.

**Counselor Use Cases:**

*   **Manage Account:**
    *   Log in with two-factor authentication (2FA).
    *   Log out of the system.
    *   Manage their profile and account settings.
*   **Manage Appointments:**
    *   View their calendar of appointments.
    *   Accept or decline appointment requests.
    *   View details of scheduled appointments.
*   **Student Management:**
    *   View a list of their assigned students.
    *   View individual student profiles.
*   **Session Management:**
    *   Create and manage session notes for each appointment.
*   **Communication:**
    *   Send and receive messages from students.
*   **Notifications:**
    *   Receive notifications for new appointment requests, messages, and urgent cases.

**Administrator Use Cases:**

*   **User Management:**
    *   **Student Management:**
        *   Create, view, edit, and delete student accounts.
        *   Upload student data via CSV.
        *   Send verification emails to students.
    *   **Counselor Management:**
        *   Create, view, edit, and delete counselor accounts.
*   **System Monitoring:**
    *   View the admin dashboard with system statistics (e.g., number of users, appointments).
    *   View recent system activity.
*   **Content and Report Management:**
    *   Manage website content and resources.
    *   View and manage session reports.
    *   Manage psychological tests available to students.
*   **System Configuration:**
    *   Manage overall system settings.

**Relationships:**

*   All three actors (Student, Counselor, Administrator) will interact with the system, but their level of access and available actions will differ.
*   Students and Counselors can interact with each other through appointments and messaging, which is facilitated by the system.
*   The Administrator oversees the interactions between Students and Counselors and manages the overall platform.

Please create a use case diagram that visually represents these actors, use cases, and their relationships within the SafeSpace system.

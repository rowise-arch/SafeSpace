Create a context diagram for a web-based counseling platform called 'SafeSpace'. The platform connects students with counselors.

**Actors:**
*   **Student:** A user seeking counseling services.
*   **Counselor:** A user providing counseling services.
*   **Admin:** A user responsible for system administration.

**System:**
*   **SafeSpace Platform:** The central software system.

**Interactions and External Systems:**
*   **Students** interact with the platform to:
    *   Sign up and sign in.
    *   Manage their profile.
    *   Schedule appointments.
    *   Send and receive messages.
    *   Access mental health resources.
    *   Receive notifications.
*   **Counselors** interact with the platform to:
    *   Log in (with 2-factor authentication).
    *   Manage their profile and account settings.
    *   View student profiles.
    *   Manage appointments.
    *   Send and receive messages.
*   **Admins** interact with the platform to:
    *   Manage student and counselor accounts (e.g., set permissions, disable accounts).
*   The **SafeSpace Platform** interacts with the following external systems:
    *   **Firebase:** To send push notifications to students and counselors.
    *   **SMTP Email Server:** To send 2-factor authentication codes to counselors.
    *   **Authentication Database:** To store and verify user credentials.
    *   **Application Database:** To store all other application data, such as appointments, messages, and user profiles.

The context diagram should depict the 'SafeSpace Platform' at the center, with flows of information to and from the 'Student', 'Counselor', and 'Admin' actors, as well as the external systems (Firebase, SMTP Email Server, Authentication Database, and Application Database).

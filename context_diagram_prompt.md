# Prompt for an Image-Generating AI to Create a Context Diagram

**Subject:** A context diagram for a web application called "SafeSpace Platform".

**Style:** A clean, modern, and professional software engineering diagram. Use simple icons and clear labels. The diagram should be easy to understand at a glance.

**Layout:**
- In the center of the image, draw a large circle and label it **"SafeSpace Platform"**. This is the main system.
- Arrange the following external entities around the central circle:

**External Entities (Actors):**
1.  **Student:** Use an icon of a person or a student with a backpack. Place this to the left of the central system.
2.  **Counselor:** Use an icon of a person with a clipboard or a friendly professional. Place this to the right of the central system.
3.  **Administrator:** Use an icon of a person with a gear or a computer screen. Place this at the top of the central system.

**External Entities (Systems):**
4.  **Firebase:** Use the Firebase logo. Place this at the bottom right.
5.  **SMTP Server:** Use an icon of an envelope or an email server. Place this at the bottom left.

**Data Flows (Arrows):**
Draw arrows between the external entities and the central "SafeSpace Platform" to represent the flow of information. Each arrow should have a clear, concise label.

**Arrows from Actors to the Platform:**
- From **Student** to **Platform**: Label arrows with "Login Info", "Profile Updates", "Appointment Requests", "Messages".
- From **Counselor** to **Platform**: Label arrows with "Login & 2FA", "Availability", "Session Notes", "Messages".
- From **Administrator** to **Platform**: Label arrows with "Login", "User Management", "Content Updates", "Report Requests".

**Arrows from the Platform to Actors:**
- From **Platform** to **Student**: Label arrows with "Profile Data", "Confirmations", "Resources", "Messages".
- From **Platform** to **Counselor**: Label arrows with "Student Profiles", "Schedule", "Messages".
- From **Platform** to **Administrator**: Label arrows with "Dashboard Data", "User Reports", "System Logs".

**Arrows between the Platform and External Systems:**
- From **Platform** to **Firebase**: Label the arrow "Push Notification Request".
- From **Platform** to **SMTP Server**: Label the arrow "Send 2FA Email".

**Final Touches:**
- Use a consistent color scheme.
- Ensure all text is legible.
- The overall composition should be balanced and professional.

# Waypoint Logistics - Keycloak Custom Login Theme

This theme provides a custom, production-grade login experience for Keycloak tailored for **SynapX Waypoint Logistics Dispatch Portal**, matching the official split-screen operational design.

---

## 🎨 Theme Highlights

- **Split Screen Layout**:
  - **Left Panel (Deep Navy Operational Hub)**:
    - Custom SynapX Waypoint Dispatch Portal brand header.
    - Large typography: *"Every delivery, under control."*
    - Value proposition description.
    - Glowing status badge: *"• Secure access · Peliyagoda DC"*.
  - **Right Panel (Dispatcher Access)**:
    - Amber eyebrow: *"DISPATCHER ACCESS"*.
    - *"Welcome back"* title and subtitle.
    - Work email field with `@` trailing icon.
    - Password field with show/hide password toggle (JavaScript eye icon).
    - *"Remember this device"* & *"Forgot password?"* links.
    - Deep navy primary button: *"Sign in to Dispatcher"*.
    - Administrator support help note and authorized personnel footer.
- **Full Keycloak Compatibility**:
  - Tested with modern Keycloak Quarkus (v18 through v26+).
  - Handles alerts, errors (e.g. invalid credentials, expired session), password reset, and first-time password updates.
  - Fully responsive: transitions cleanly to stacked view on tablets and mobile devices.

---

## 🚀 How to Import into Keycloak

You can import this theme into Keycloak using **either** of two standard methods:

### Method 1: Deploy as a JAR Provider (Recommended for Keycloak 17+ Quarkus)

A pre-built JAR archive `waypoint-theme.jar` is already provided in this directory.

1. **Copy `waypoint-theme.jar` into your Keycloak `providers/` directory**:
   - In Docker Compose:
     ```yaml
     services:
       keycloak:
         image: quay.io/keycloak/keycloak:24.0.0
         volumes:
           - ./keycloak-theme/waypoint-theme.jar:/opt/keycloak/providers/waypoint-theme.jar:ro
     ```
   - In a running Docker container:
     ```bash
     docker cp ./keycloak-theme/waypoint-theme.jar <keycloak-container-id>:/opt/keycloak/providers/
     docker restart <keycloak-container-id>
     ```

---

### Method 2: Mount as Theme Directory (Docker Volume / Local Dev)

You can mount the `waypoint` directory directly into Keycloak's `themes/` folder:

1. **Docker Compose example**:
   ```yaml
   services:
     keycloak:
       image: quay.io/keycloak/keycloak:24.0.0
       command: start-dev
       volumes:
         - ./keycloak-theme/waypoint:/opt/keycloak/themes/waypoint:ro
       ports:
         - "8080:8080"
   ```

2. **Standalone / Bare-metal Keycloak**:
   Copy the `waypoint` folder directly into:
   ```
   <KEYCLOAK_HOME>/themes/waypoint
   ```

---

## ⚙️ How to Activate the Theme in Keycloak

1. Open the **Keycloak Admin Console** (e.g., `http://localhost:8080/admin`).
2. Select your realm (e.g., **`waypointlogistics`**).
3. In the left navigation menu, click **Realm Settings**.
4. Click on the **Themes** tab.
5. In the **Login theme** dropdown, select **`waypoint`**.
6. Click **Save**.
7. Sign out or open your login URL in an Incognito window to view the new login screen!

---

## 🛠️ Rebuilding the JAR from Source

If you make modifications to any `.ftl` templates, CSS, or JS files:

- **On Windows (PowerShell)**:
  ```powershell
  cd keycloak-theme
  .\build-theme-jar.ps1
  ```
- **On Linux / macOS (Bash)**:
  ```bash
  cd keycloak-theme
  chmod +x build-theme-jar.sh
  ./build-theme-jar.sh
  ```

---

## 📂 File Structure

```
keycloak-theme/
├── waypoint-theme.jar           # Ready-to-deploy Keycloak JAR archive
├── preview.html                 # Standalone HTML preview (open in browser)
├── build-theme-jar.ps1          # PowerShell build script for Windows
├── build-theme-jar.sh           # Bash build script for Linux/macOS
├── README.md                    # Documentation & setup guide
└── waypoint/                    # Theme source folder
    └── login/
        ├── theme.properties     # Theme metadata and asset bindings
        ├── template.ftl         # Master split-screen layout template
        ├── login.ftl            # Dispatcher login form template
        ├── login-reset-password.ftl # Forgot password form template
        ├── login-update-password.ftl# Update password form template
        ├── error.ftl            # Friendly error screen template
        ├── messages/
        │   └── messages_en.properties # Custom UI labels & error messages
        └── resources/
            ├── css/
            │   └── style.css    # Custom styles & design tokens
            ├── js/
            │   └── script.js    # Password visibility toggle & interactions
            └── img/             # Theme graphics & icons
```

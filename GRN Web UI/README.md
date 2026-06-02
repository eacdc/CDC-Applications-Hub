# CDC Mobile App

A Flutter mobile application for CDC process management system that integrates with the existing backend APIs.

## Features

- **User Authentication**: Login with User ID to access available machines
- **Machine Selection**: View and select from available machines for the logged-in user
- **Process Management**: Fetch and view pending processes for selected machines
- **Modern UI**: Clean, responsive design with Material Design 3

## API Integration

The app integrates with the following backend endpoints:

1. **Login API**: `GET /api/auth/login?userId={userId}`
   - Returns available machines for the user
   - Validates user access permissions

2. **Process Details API**: `GET /api/processes/pending?MachineID={machineId}&JBJCID={jbjcId}`
   - Returns pending processes for a specific machine and job booking

## Setup Instructions

### Prerequisites

- Flutter SDK (3.0.0 or higher)
- Dart SDK
- Android Studio / VS Code with Flutter extensions
- Backend server running on `https://cdcapi.onrender.com/api`

### Installation

1. **Clone or navigate to the project directory**
   ```bash
   cd "C:\Users\User\Desktop\CDC Site"
   ```

2. **Navigate to the Dart/Flutter project**
   ```bash
   cd dart_files
   ```

3. **Install Flutter dependencies**
   ```bash
   flutter pub get
   ```

4. **Update API URL (if needed)**
   - Open `dart_files/lib/config/api_config.dart`
   - Update the `baseUrl` constant if your backend runs on a different port or host

5. **Run the app**
   ```bash
   flutter run
   ```

### Configuration

#### Backend URL Configuration

The app is configured to use the production backend on Render: `https://cdcapi.onrender.com/api/api`

To switch environments, update the `baseUrl` in `dart_files/lib/config/api_config.dart`:

```dart
static const String baseUrl = ApiConfig.productionUrl; // For production
static const String baseUrl = ApiConfig.localUrl;      // For local development
static const String baseUrl = ApiConfig.webUrl;        // For local network testing
```

#### For Android Emulator/Device

If testing on Android emulator, you might need to use `http://10.0.2.2:3001/api` instead of `localhost`.

#### For Physical Device

Use your computer's IP address: `http://YOUR_IP_ADDRESS:3001/api`

## App Flow

1. **Login Screen**: Enter User ID to authenticate
2. **Machine Selection**: Choose from available machines
3. **Process Details**: Enter JBJC ID to fetch pending processes
4. **View Results**: Display process information in a clean, organized format

## Project Structure

```
CDC Site/
├── dart_files/              # Flutter/Dart application
│   ├── lib/                 # Dart source code
│   │   ├── main.dart        # App entry point
│   │   ├── models/          # Data models
│   │   │   ├── machine.dart         # Machine model
│   │   │   ├── process.dart         # Process model
│   │   │   └── api_response.dart    # API response wrapper
│   │   ├── services/        # API services
│   │   │   └── api_service.dart     # HTTP client and API calls
│   │   ├── providers/       # State management
│   │   │   └── app_provider.dart    # App state provider
│   │   └── screens/         # UI screens
│   │       ├── login_screen.dart           # Login interface
│   │       ├── machine_selection_screen.dart # Machine selection
│   │       └── process_details_screen.dart   # Process details
│   ├── android/             # Android platform files
│   ├── ios/                 # iOS platform files
│   ├── test/                # Test files
│   ├── pubspec.yaml         # Flutter dependencies
│   └── analysis_options.yaml # Dart analysis rules
└── backend/                 # Node.js backend server
    ├── src/                 # Server source code
    │   ├── server.js        # Main server file
    │   ├── routes.js        # API routes
    │   └── db.js           # Database configuration
    ├── package.json         # Node.js dependencies
    └── README.md           # Backend documentation
```

## Dependencies

- `http`: For API communication
- `provider`: For state management
- `shared_preferences`: For local data storage (future use)

## Testing

1. **Start your backend server** on port 3001
2. **Run the Flutter app**
3. **Test with valid User IDs** from your database
4. **Verify machine selection** works correctly
5. **Test process fetching** with valid Machine ID and JBJC ID combinations

## Troubleshooting

### Common Issues

1. **Network Error**: Ensure backend server is running and accessible
2. **No Machines Found**: Verify User ID exists in database and has proper permissions
3. **No Processes Found**: Check Machine ID and JBJC ID combinations in database

### Debug Mode

Run with debug logging:
```bash
flutter run --debug
```

## Future Enhancements

- Offline data caching
- Push notifications
- Process status updates
- User profile management
- Advanced filtering and search
- Data export functionality

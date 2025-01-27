# Synthetic Monitoring Service

Internal synthetic monitoring service that validates application functionality using Puppeteer and exposes Prometheus metrics. The service supports monitoring multiple targets with different login flows and success criteria.

## Setup

```bash
npm install
```

## Configuration

The service uses a JSON configuration file that can be mounted via Kubernetes secrets. The configuration file structure is as follows:

```json
{
  "targets": [
    {
      "name": "example-app",
      "loginUrl": "https://example.com/login",
      "selectors": {
        "usernameField": "input[name=\"email\"]",
        "passwordField": "input[name=\"password\"]",
        "submitButton": "button[type=\"submit\"]",
        "successByCss": false,
        "successByUrl": true,
        "successValue": "https://example.com/dashboard"
      },
      "credentials": {
        "username": "user@example.com",
        "password": "password"
      },
      "checkInterval": 300000
    }
  ]
}
```

### Configuration Options

- `name`: Unique identifier for the target
- `loginUrl`: URL of the login page
- `selectors`:
  - `usernameField`: CSS selector for username input
  - `passwordField`: CSS selector for password input
  - `submitButton`: CSS selector for submit button
  - `successByCss`: If true, verify login by waiting for CSS selector
  - `successByUrl`: If true, verify login by checking final URL
  - `successValue`: CSS selector or URL to verify successful login
- `credentials`: Login credentials
- `checkInterval`: Time between checks in milliseconds (default: 300000)

### Environment Variables

- `SYNTHETIC_MONITOR_CONFIG_FILE`: Path to configuration file (default: `/etc/synthetic-monitor/config.json`)
- `DEBUG`: Enable debug logging (default: false)
- `PORT`: Server port (default: 3000)

## Deployment

The service is designed to work with External Secrets Operator (ESO) for secure configuration management.

1. Store your configuration in Vault
2. Create an ExternalSecret:
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: synthetic-monitor-config
spec:
  refreshInterval: "1h"
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: synthetic-monitor-config
  data:
    - secretKey: config.json
      remoteRef:
        key: secret/data/synthetics/config
```

3. Build Docker image:
   - Production: `docker build --target production -t synthetic-monitor:latest .`
   - Testing: `docker build --target test -t synthetic-monitor:test .`

4. Deploy to Kubernetes: `kubectl apply -f kubernetes/`

## Metrics

Available at `/metrics`:
- `app_login_duration_seconds`: Histogram of login attempt durations (labeled by target)
- `app_login_success_total`: Counter of successful logins (labeled by target)
- `app_login_failure_total`: Counter of failed logins (labeled by target)

## Debug Logging

When `DEBUG` is enabled, the service outputs structured JSON logs with detailed information about:
- Configuration loading
- Browser and page lifecycle events
- Login attempts and results
- Navigation events
- Error details with stack traces

Example log:
```json
{
  "timestamp": "2025-01-27T20:41:02.000Z",
  "level": "info",
  "message": "Starting login check",
  "target": "example-app",
  "url": "https://example.com/login"
}

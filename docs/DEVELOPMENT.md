# Development

The scripts operate locally and never deploy. Install Node.js 24, JDK 17, Python 3, PostgreSQL 16, and optionally FFmpeg and Pillow for the pilot renderer. Run the PostgreSQL suite as a non-root user.

```sh
bash scripts/build-gateway.sh
bash scripts/test.sh
```

For a local Android candidate, install SDK platform 36 and build-tools 36.0.0, configure ANDROID_HOME, and use a local debug keystore: `bash build-product.sh`. A debug-signed APK is not a production release.

## Deployment configuration

The public source uses https://gateway.example.invalid and https://example.supabase.co as example configuration. Run `python3 scripts/configure-deployment.py --gateway https://your-gateway.example.org --supabase https://your-project.supabase.co` in an isolated release checkout before building. It replaces the consistent origin placeholders in source and migration templates. Never commit the configured checkout or apply a changed historical migration to an existing installation. The OAuth resource and the actual deployment origin must match exactly. The database migration filenames are aligned with the original deployment history; configure a fresh instance or reconcile an existing instance using verified migration history.

CI is validation-only until a separately reviewed deployment workflow is configured with scoped credentials. No cloud resources or account changes are made by these scripts. Keep runtime secrets in the deployment platform.

See [release workflow](RELEASE.md) for the approved candidate-upload boundary and remaining deployment prerequisites.

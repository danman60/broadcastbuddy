
## From CommandCentered-2 — 2026-03-31 01:00

### Feature Request: Large File Upload with Progress Bar

The gallery editor upload uses presigned PUT URLs — max 5GB per single PUT. User tried uploading a 15GB recital video and it failed.

**Needed:**
1. **Multipart upload** support for files > 5GB (R2/S3 multipart API)
2. **Progress bar** in the gallery editor UI showing upload percentage
3. Should work for both the editor upload UI and future BB app uploads

R2 supports multipart uploads via S3-compatible API. The flow:
- `CreateMultipartUpload` → get uploadId
- Split file into 100MB chunks → `UploadPart` each with presigned URL
- `CompleteMultipartUpload` when all parts done
- Track progress client-side as each part completes

This should be a reusable upload component, not gallery-specific.

# Current Work - BroadcastBuddy

## Active Task
Field Mapper for LLM Import - Phase 1 Core UI complete

## Commits
- `8a13ede` — Phase 1 MVP: core overlay system (41 files)
- `5fef0ea` — Phase 2+3: document import, templates, ticker (19 files)
- `19a7511` — Brand kit scraper, 30 Google Fonts, split/blur animations
- `791a8c3` — Playlist mode, per-entry logos, Stream Deck plugin
- `9ca7ca1` — Playlist system upgrade: DnD, played indicators, loop modes, bulk ops
- (pending) — Field Mapper for LLM Import

## Field Mapper Implementation (IN PROGRESS)

### What Was Added
- **Types** (`src/shared/types.ts`): Added `LLMExtractedField`, `FieldMapping`, `TransformConfig`, `MappingPreset`, `ExtractionResult`, new IPC channels
- **LLM Service** (`src/main/services/llmService.ts`): Modified to return `ExtractionResult` with raw fields, sample data, and suggested mappings
- **Document Import** (`src/main/services/documentImport.ts`): Updated to use new `ExtractionResult` interface
- **ImportPanel** (`src/renderer/components/ImportPanel.tsx`): Added 'mapping' stage, state management, FieldMapper integration
- **FieldMapper Component** (`src/renderer/components/FieldMapper.tsx`): New component with:
  - Draggable source fields
  - Drop targets for trigger fields (name, title, subtitle, category)
  - Live preview table with editable cells
  - Transform support (concat, format, extract, split)
- **Styles** (`src/renderer/styles/fieldMapper.css`): Complete styling for the mapper UI

### How It Works
1. User browses for document → text preview
2. User clicks "Extract Triggers with AI" → LLM returns raw fields + sample data
3. **NEW**: Field mapper stage shows:
   - Left: Source fields discovered by LLM (draggable chips)
   - Center: Transform options
   - Right: Trigger target fields (drop zones)
   - Preview panel: Live table showing mapped results
4. User drags source fields to targets to map them
5. Multiple sources can combine (auto-concat mode)
6. User clicks "Apply & Import" → proceeds to review stage

### Files Modified
- `src/shared/types.ts` — New field mapping types
- `src/main/services/llmService.ts` — Return extraction result structure
- `src/main/services/documentImport.ts` — Updated interface
- `src/renderer/components/ImportPanel.tsx` — Mapping stage integration
- `src/renderer/components/FieldMapper.tsx` — **NEW**
- `src/renderer/styles/fieldMapper.css` — **NEW**

### Build Status
- `tsc --noEmit` — PASS (zero type errors)
- `npm run build` — PENDING

### Next Steps
1. Run full build
2. Test with actual documents
3. Add preset save/load (Phase 3)
4. Consider "learn from edit" feature (Phase 2)

## Known Issues/TODO
- Preset persistence not implemented yet (Phase 3)
- Edit-in-preview doesn't actually learn/save transforms yet (Phase 2)
- No visualization of transform connections (nice-to-have)

# Feature: Parallel Image Pulls for Update Check

## Overview

Speed up container update checks by pulling multiple images in parallel instead of sequentially.

## Problem

Current sequential approach takes ~3s per container:
- 11 containers = ~33 seconds
- Each image pull waits for completion before starting next

## Solution

Pull images in parallel batches (3-4 at a time):
- 11 containers with 4 parallel = ~9 seconds (3 batches)
- 3-4x speedup with minimal complexity

---

## Implementation Tasks

### Phase 1: Parallel Pull Infrastructure

- [ ] **1.1** Add configuration constant
  ```javascript
  PARALLEL_PULLS: 4  // Number of concurrent pulls
  ```

- [ ] **1.2** Create `pullMultipleImages(images)` method
  - Takes array of image names
  - Starts all pulls with `pullStream()` simultaneously
  - Returns array of `{image, sessionId}` objects

- [ ] **1.3** Create `waitForAllPulls(sessions)` method
  - Takes array of `{image, sessionId}` objects
  - Single polling loop checks ALL sessions each tick
  - Tracks completion status per session
  - Returns when ALL sessions complete
  - Returns array of `{image, success, error}` results

### Phase 2: Update Check Integration

- [ ] **2.1** Create `batchArray(array, batchSize)` helper
  - Splits array into chunks of specified size
  - Returns array of arrays

- [ ] **2.2** Update `checkForUpdates()` method
  ```
  1. Split containers into batches of PARALLEL_PULLS size
  2. For each batch:
     a. Call pullMultipleImages() for batch
     b. Call waitForAllPulls()
     c. Inspect images and compare digests
     d. Collect results
  3. Return all results
  ```

### Phase 3: Progress UI

- [ ] **3.1** Update progress callback signature
  - Add batch info: `onProgress(container, idx, total, batchNum, batchTotal)`

- [ ] **3.2** Update `overview.js` progress display
  - Show batch progress: "Batch 2/3"
  - Show containers in current batch
  - Example: "Checking: grafana, nginx, mariadb, redis..."

---

## Technical Design

### Polling Multiple Sessions

```javascript
waitForAllPulls: function(sessions) {
    const results = [];
    const pending = new Map(sessions.map(s => [s.sessionId, s]));
    const offsets = new Map(sessions.map(s => [s.sessionId, 0]));

    const pollAll = () => {
        const checks = Array.from(pending.keys()).map(sessionId => {
            return podmanRPC.image.pullStatus(sessionId, offsets.get(sessionId))
                .then(status => {
                    if (status.output) {
                        offsets.set(sessionId, offsets.get(sessionId) + status.output.length);
                    }
                    if (status.complete) {
                        const session = pending.get(sessionId);
                        pending.delete(sessionId);
                        results.push({
                            image: session.image,
                            success: status.success
                        });
                    }
                });
        });

        return Promise.all(checks).then(() => {
            if (pending.size === 0) {
                return results;
            }
            return new Promise(resolve => {
                setTimeout(() => pollAll().then(resolve), POLL_INTERVAL);
            });
        });
    };

    return pollAll();
}
```

### Batch Processing

```javascript
checkForUpdates: function(containers, onProgress) {
    const batches = this.batchArray(containers, this.PARALLEL_PULLS);
    const results = [];

    const processNextBatch = (batchIdx) => {
        if (batchIdx >= batches.length) {
            return Promise.resolve(results);
        }

        const batch = batches[batchIdx];
        const images = batch.map(c => c.image);

        // Notify UI about current batch
        if (onProgress) {
            onProgress(batch, batchIdx + 1, batches.length);
        }

        return this.pullMultipleImages(images)
            .then(sessions => this.waitForAllPulls(sessions))
            .then(pullResults => {
                // Inspect and compare for each container in batch
                return Promise.all(batch.map((container, i) => {
                    const pullResult = pullResults[i];
                    if (!pullResult.success) {
                        return { ...container, hasUpdate: false, error: 'Pull failed' };
                    }
                    return podmanRPC.image.inspect(container.image)
                        .then(newImage => ({
                            name: container.name,
                            image: container.image,
                            running: container.running,
                            hasUpdate: container.imageId !== newImage.Id
                        }));
                }));
            })
            .then(batchResults => {
                results.push(...batchResults);
                return processNextBatch(batchIdx + 1);
            });
    };

    return processNextBatch(0);
}
```

---

## File Changes

### Modified Files
- `htdocs/luci-static/resources/podman/auto-update.js` - Add parallel methods
- `htdocs/luci-static/resources/view/podman/overview.js` - Update progress UI

---

## Expected Performance

| Containers | Sequential | Parallel (4) | Speedup |
|------------|------------|--------------|---------|
| 4          | 12s        | 3s           | 4x      |
| 8          | 24s        | 6s           | 4x      |
| 11         | 33s        | 9s           | 3.7x    |
| 20         | 60s        | 15s          | 4x      |

---

## Error Handling

- If one pull in batch fails → record error, continue with others
- If all pulls in batch fail → continue to next batch
- Network interruption → each pull has independent error state

---

## Configuration Options (Future)

Could add user-configurable parallel pull count:
- Low-end routers: 2 parallel
- Mid-range: 3-4 parallel
- High-end: 5-6 parallel

For now, hardcode conservative default of 4.

---

## Testing Checklist

- [ ] Single container (batch size 1)
- [ ] Exactly 4 containers (1 full batch)
- [ ] 5 containers (1 full + 1 partial batch)
- [ ] 11 containers (2 full + 1 partial)
- [ ] Mixed success/failure in same batch
- [ ] All failures in one batch
- [ ] Large images (verify no timeout)
- [ ] Progress UI shows correct batch info

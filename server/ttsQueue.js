// ttsQueue.js
// Minimal FIFO queue to control concurrent TTS generation background jobs
let queue = [];
let activeJobsCount = 0;
const MAX_CONCURRENT = 2;

// Tracking sets for deduplication
const queuedSet = new Set();
const activeSet = new Set();

const log = (msg, type = 'INFO') => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [TTS Queue] [${type}] ${msg}`);
};

export const enqueue = (contentId, jobFn) => {
  return new Promise((resolve, reject) => {
    if (queuedSet.has(contentId) || activeSet.has(contentId)) {
      log(`TTS job skipped duplicate: ${contentId}`, 'WARN');
      return resolve({
        success: true,
        duplicateSkipped: true,
        message: 'Job already active or queued.',
      });
    }

    log(`TTS job queued: ${contentId}`, 'INFO');

    queuedSet.add(contentId);
    queue.push({ contentId, jobFn, resolve, reject });

    processQueue();
  });
};

const processQueue = () => {
  while (activeJobsCount < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();

    queuedSet.delete(job.contentId);
    activeSet.add(job.contentId);
    activeJobsCount++;

    log(`TTS job started: ${job.contentId}. Active jobs: ${activeJobsCount}`, 'INFO');

    Promise.resolve()
      .then(() => job.jobFn())
      .then((result) => {
        log(`TTS job finished: ${job.contentId}`, 'SUCCESS');
        job.resolve(result);
      })
      .catch((err) => {
        const errorMessage =
          err && typeof err === 'object' && 'message' in err
            ? err.message
            : String(err);
        log(`TTS job failed: ${job.contentId} -> ${errorMessage}`, 'ERROR');
        job.reject(err);
      })
      .finally(() => {
        activeJobsCount--;
        activeSet.delete(job.contentId);
        processQueue();
      });
  }
};

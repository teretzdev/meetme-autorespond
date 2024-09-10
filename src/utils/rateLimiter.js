import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  minTime: 1000 // 1 request per second
});

function rateLimiter() {
  return limiter.schedule(() => Promise.resolve());
}

export { rateLimiter };
-- Create the proxies table
CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL, -- 'active', 'inactive'
    added_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    speed INTEGER NOT NULL -- Ping speed in milliseconds
);

-- Index for faster retrieval of top proxies
CREATE INDEX IF NOT EXISTS idx_proxies_status_speed ON proxies(status, speed);

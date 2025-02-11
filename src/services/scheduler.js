// File: src/services/scheduler.js
const cron = require('node-cron');

class Scheduler {
    constructor(client, achievementTrackingService) {
        if (!client || !client.isReady()) {
            throw new Error('Discord client must be ready before initializing scheduler');
        }
        if (!achievementTrackingService) {
            throw new Error('Achievement tracking service is required');
        }
        
        this.client = client;
        this.achievementTrackingService = achievementTrackingService;
        this.jobs = new Map();

        // Achievement check every 5 minutes
        this.jobs.set('achievementCheck', cron.schedule('*/5 * * * *', async () => {
            console.log('Starting scheduled achievement check...');
            try {
                await this.achievementTrackingService.checkAchievements();
                console.log('Scheduled achievement check completed');
            } catch (error) {
                console.error('Error in scheduled achievement check:', error);
            }
        }, {
            scheduled: false // Don't start automatically
        }));

        // Daily cleanup at midnight
        this.jobs.set('dailyCleanup', cron.schedule('0 0 * * *', async () => {
            console.log('Starting daily cleanup...');
            try {
                // Clear caches in relevant services
                if (this.client.achievementFeedService) {
                    this.client.achievementFeedService.clearCache();
                }
                if (this.client.usernameUtils) {
                    this.client.usernameUtils.clearCache();
                }
                console.log('Daily cleanup completed');
            } catch (error) {
                console.error('Error in daily cleanup:', error);
            }
        }, {
            scheduled: false
        }));

        // Weekly maintenance tasks (Sunday at 2 AM)
        this.jobs.set('weeklyMaintenance', cron.schedule('0 2 * * 0', async () => {
            console.log('Starting weekly maintenance...');
            try {
                // Add any weekly maintenance tasks here
                console.log('Weekly maintenance completed');
            } catch (error) {
                console.error('Error in weekly maintenance:', error);
            }
        }, {
            scheduled: false
        }));

        // Monthly rollover (1st of each month at 0:05 AM)
        this.jobs.set('monthlyRollover', cron.schedule('5 0 1 * *', async () => {
            console.log('Starting monthly rollover...');
            try {
                if (this.client.leaderboardService) {
                    await this.client.leaderboardService.updateAllLeaderboards();
                }
                console.log('Monthly rollover completed');
            } catch (error) {
                console.error('Error in monthly rollover:', error);
            }
        }, {
            scheduled: false
        }));

        console.log('Scheduler constructed with the following jobs:', 
            Array.from(this.jobs.keys()).join(', '));
    }

    async initialize() {
        try {
            // Make sure client is ready
            if (!this.client.isReady()) {
                throw new Error('Discord client not ready');
            }
            
            console.log('Scheduler initialized');
            return true;
        } catch (error) {
            console.error('Error initializing scheduler:', error);
            throw error;
        }
    }

    startAll() {
        try {
            for (const [jobName, job] of this.jobs) {
                job.start();
                console.log(`Started ${jobName} job`);
            }
            console.log('All scheduled jobs started');
        } catch (error) {
            console.error('Error starting scheduled jobs:', error);
            throw error;
        }
    }

    stopAll() {
        try {
            for (const [jobName, job] of this.jobs) {
                job.stop();
                console.log(`Stopped ${jobName} job`);
            }
            console.log('All scheduled jobs stopped');
        } catch (error) {
            console.error('Error stopping scheduled jobs:', error);
        }
    }

    /**
     * Start a specific job by name
     */
    startJob(jobName) {
        const job = this.jobs.get(jobName);
        if (job) {
            job.start();
            console.log(`Started ${jobName} job`);
        } else {
            console.error(`Job ${jobName} not found`);
        }
    }

    /**
     * Stop a specific job by name
     */
    stopJob(jobName) {
        const job = this.jobs.get(jobName);
        if (job) {
            job.stop();
            console.log(`Stopped ${jobName} job`);
        } else {
            console.error(`Job ${jobName} not found`);
        }
    }

    /**
     * Get the status of all jobs
     */
    getStatus() {
        const status = {};
        for (const [jobName, job] of this.jobs) {
            status[jobName] = {
                running: job.getStatus() === 'scheduled',
                lastRun: job.lastRun,
                nextRun: job.nextRun
            };
        }
        return status;
    }

    /**
     * Run a job immediately, regardless of its schedule
     */
    async runJobNow(jobName) {
        console.log(`Manually running ${jobName} job`);
        try {
            switch (jobName) {
                case 'achievementCheck':
                    await this.achievementTrackingService.checkAchievements();
                    break;
                case 'dailyCleanup':
                    if (this.client.achievementFeedService) {
                        this.client.achievementFeedService.clearCache();
                    }
                    if (this.client.usernameUtils) {
                        this.client.usernameUtils.clearCache();
                    }
                    break;
                default:
                    console.error(`Job ${jobName} not found or cannot be run manually`);
            }
        } catch (error) {
            console.error(`Error running ${jobName} job:`, error);
        }
    }

    /**
     * Clean up resources when shutting down
     */
    async shutdown() {
        console.log('Shutting down scheduler...');
        this.stopAll();
        if (this.client.achievementFeedService) {
            this.client.achievementFeedService.setPaused(true);
        }
    }
}

module.exports = Scheduler;

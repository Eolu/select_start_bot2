// File: src/services/awardService.js
const Award = require('../models/Award');
const Game = require('../models/Game');
const User = require('../models/User');
const { AwardType, AwardFunctions } = require('../enums/AwardType');

class AwardService {
    constructor(achievementFeedService, usernameUtils) {
        if (!achievementFeedService) {
            throw new Error('Achievement feed service is required');
        }
        if (!usernameUtils) {
            throw new Error('Username utils is required');
        }

        this.feedService = achievementFeedService;
        this.usernameUtils = usernameUtils;
        console.log('Award Service initialized');
    }

    /**
     * Add manual points award to a user
     */
    async addManualAward(username, points, reason, awardedBy, metadata = null) {
        try {
            const canonicalUsername = await this.usernameUtils.getCanonicalUsername(username);
            const normalizedUsername = canonicalUsername.toLowerCase();

            const award = new Award({
                raUsername: normalizedUsername,
                gameId: 'manual',
                month: new Date().getMonth() + 1,
                year: new Date().getFullYear(),
                award: AwardType.MANUAL,
                totalAchievements: points,
                reason: reason,
                awardedBy: awardedBy,
                metadata: metadata
            });

            await award.save();

            // Announce the award
            await this.feedService.announcePointsAward(
                canonicalUsername,
                points,
                reason
            );

            return award;
        } catch (error) {
            console.error(`Error adding manual award for ${username}:`, error);
            throw error;
        }
    }

    /**
     * Remove a manual award
     */
    async removeManualAward(awardId) {
        try {
            const award = await Award.findById(awardId);
            if (!award || award.gameId !== 'manual') {
                throw new Error('Invalid award ID or not a manual award');
            }

            await Award.findByIdAndDelete(awardId);
            return true;
        } catch (error) {
            console.error(`Error removing manual award ${awardId}:`, error);
            throw error;
        }
    }

    /**
     * Get all manual awards for a user
     */
    async getManualAwards(username) {
        try {
            const normalizedUsername = username.toLowerCase();
            const currentYear = new Date().getFullYear();

            const awards = await Award.find({
                raUsername: normalizedUsername,
                gameId: 'manual',
                year: currentYear
            }).sort({ awardedAt: -1 });

            return awards;
        } catch (error) {
            console.error(`Error getting manual awards for ${username}:`, error);
            throw error;
        }
    }

    /**
     * Calculate total points for a user
     */
    async calculateTotalPoints(username) {
        try {
            const normalizedUsername = username.toLowerCase();
            const currentYear = new Date().getFullYear();

            const awards = await Award.find({
                raUsername: normalizedUsername,
                year: currentYear
            });

            const points = {
                total: 0,
                challenge: 0,
                community: 0,
                breakdown: {
                    mastered: 0,
                    beaten: 0,
                    participation: 0,
                    manual: 0
                }
            };

            const processedGames = new Set();

            for (const award of awards) {
                if (award.gameId === 'manual') {
                    points.community += award.totalAchievements;
                    points.total += award.totalAchievements;
                    points.breakdown.manual += award.totalAchievements;
                    continue;
                }

                const gameKey = `${award.gameId}-${award.month}`;
                if (!processedGames.has(gameKey)) {
                    processedGames.add(gameKey);

                    if (award.award >= AwardType.MASTERED) {
                        points.challenge += 7;
                        points.breakdown.mastered++;
                    } else if (award.award >= AwardType.BEATEN) {
                        points.challenge += 4;
                        points.breakdown.beaten++;
                    } else if (award.award >= AwardType.PARTICIPATION) {
                        points.challenge += 1;
                        points.breakdown.participation++;
                    }
                }
            }

            points.total = points.challenge + points.community;
            return points;
        } catch (error) {
            console.error(`Error calculating points for ${username}:`, error);
            throw error;
        }
    }

    /**
     * Add placement award (for monthly rankings)
     */
    async addPlacementAward(username, placement, month) {
        const placementMap = {
            'first': { points: 5, emoji: '🥇', name: 'First Place' },
            'second': { points: 3, emoji: '🥈', name: 'Second Place' },
            'third': { points: 2, emoji: '🥉', name: 'Third Place' }
        };

        const placementInfo = placementMap[placement.toLowerCase()];
        if (!placementInfo) {
            throw new Error('Invalid placement');
        }

        const metadata = {
            type: 'placement',
            placement: placementInfo.name,
            month: month,
            emoji: placementInfo.emoji
        };

        return this.addManualAward(
            username,
            placementInfo.points,
            `${placementInfo.emoji} ${placementInfo.name} - ${month}`,
            'System',
            metadata
        );
    }

    /**
     * Check if an award exists for a game
     */
    async hasAward(username, gameId, month, year) {
        const award = await Award.findOne({
            raUsername: username.toLowerCase(),
            gameId: gameId,
            month: month,
            year: year
        });

        return award !== null;
    }

    /**
     * Get the highest award level for a game
     */
    async getHighestAward(username, gameId, month, year) {
        const award = await Award.findOne({
            raUsername: username.toLowerCase(),
            gameId: gameId,
            month: month,
            year: year
        });

        return award ? award.award : AwardType.NONE;
    }

    /**
     * Get yearly award statistics for a user
     */
    async getYearlyStats(username) {
        const year = new Date().getFullYear();
        const normalizedUsername = username.toLowerCase();

        const awards = await Award.find({
            raUsername: normalizedUsername,
            year: year
        });

        const stats = {
            mastered: 0,
            beaten: 0,
            participation: 0,
            manualPoints: 0,
            totalPoints: 0,
            monthlyPlacements: []
        };

        const processedGames = new Set();

        for (const award of awards) {
            if (award.gameId === 'manual') {
                stats.manualPoints += award.totalAchievements;
                if (award.metadata?.type === 'placement') {
                    stats.monthlyPlacements.push({
                        month: award.metadata.month,
                        placement: award.metadata.placement,
                        points: award.totalAchievements
                    });
                }
                continue;
            }

            const gameKey = `${award.gameId}-${award.month}`;
            if (!processedGames.has(gameKey)) {
                processedGames.add(gameKey);

                if (award.award >= AwardType.MASTERED) {
                    stats.mastered++;
                } else if (award.award >= AwardType.BEATEN) {
                    stats.beaten++;
                } else if (award.award >= AwardType.PARTICIPATION) {
                    stats.participation++;
                }
            }
        }

        stats.totalPoints = (stats.mastered * 7) + (stats.beaten * 4) + 
                          stats.participation + stats.manualPoints;

        return stats;
    }
}

module.exports = AwardService;

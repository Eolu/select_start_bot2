// File: src/commands/arcade.js
const { EmbedBuilder } = require('discord.js');
const RetroAchievementsAPI = require('../services/retroAchievements');
const User = require('../models/User');

// Arcade configuration: each entry defines a known leaderboard
const arcadeConfigs = [
    {
        leaderboardId: 1143,     // Specific leaderboard ID
        gameId: 533,            // Game ID for Mario Kart Super Circuit
        name: "Mario Kart: Super Circuit (GBA) - Mario Circuit",
    },
    {
        leaderboardId: 18937,    // Leaderboard ID for THPS warehouse
        gameId: 146,            // Game ID for THPS
        name: "Tony Hawk's Pro Skater (PSX) - Warehouse, Woodland Hills",
    },
    {
        leaderboardId: 24,       // Leaderboard ID for Tetris
        gameId: 7,              // Game ID for Tetris
        name: "Tetris (GB) - A-Type Challenge",
    }
];

async function fetchLeaderboardEntries(leaderboardId) {
    const raAPI = new RetroAchievementsAPI(process.env.RA_USERNAME, process.env.RA_API_KEY);
    try {
        console.log(`Fetching leaderboard data for leaderboard ID: ${leaderboardId}`);
        const data = await raAPI.getLeaderboardInfo(leaderboardId);
        console.log('Raw leaderboard response:', data);
        
        if (!data || !Array.isArray(data)) {
            console.log('No valid leaderboard entries received');
            return [];
        }

        // Process the entries
        const entries = data.map(entry => ({
            Rank: parseInt(entry.Rank),
            User: entry.User,
            Score: parseInt(entry.Score),
            DateSubmitted: entry.DateSubmitted
        })).filter(entry => !isNaN(entry.Rank) && !isNaN(entry.Score));

        // Sort by rank just in case
        entries.sort((a, b) => a.Rank - b.Rank);

        console.log(`Processed ${entries.length} leaderboard entries`);
        return entries;
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        throw error;
    }
}

function formatEntry(entry) {
    let rankEmoji = '';
    if (entry.Rank === 1) {
        rankEmoji = '👑';
    } else if (entry.Rank === 2) {
        rankEmoji = '🥈';
    } else if (entry.Rank === 3) {
        rankEmoji = '🥉';
    }
    
    // Format the score nicely
    const score = Number(entry.Score).toLocaleString();
    return `${rankEmoji} Rank #${entry.Rank} - ${entry.User}: ${score}`;
}

module.exports = {
    name: 'arcade',
    description: 'Displays highscore lists for preset arcade games (for registered users only)',
    async execute(message, args) {
        try {
            // If no argument is provided, list available leaderboards
            if (!args[0]) {
                let listText = '**Available Arcade Leaderboards:**\n\n';
                arcadeConfigs.forEach((config, index) => {
                    listText += `${index + 1}. ${config.name}\n`;
                });
                listText += `\nType \`!arcade <number>\` to view that leaderboard.`;
                
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('Arcade Leaderboards')
                    .setDescription(listText)
                    .setFooter({ text: 'Data provided by RetroAchievements.org' });
                
                return message.channel.send({ embeds: [embed] });
            }

            // Parse the selection number
            const selection = parseInt(args[0]);
            if (isNaN(selection) || selection < 1 || selection > arcadeConfigs.length) {
                return message.reply(`Invalid selection. Please choose a number between 1 and ${arcadeConfigs.length}.`);
            }

            const selectedConfig = arcadeConfigs[selection - 1];

            // Show loading message
            const loadingMessage = await message.channel.send('Fetching leaderboard data...');

            // Fetch leaderboard entries using the leaderboard ID
            let leaderboardEntries = await fetchLeaderboardEntries(selectedConfig.leaderboardId);

            // Retrieve registered users from database
            const users = await User.find({});
            const registeredUserSet = new Set(users.map(u => u.raUsername.toLowerCase()));

            // Filter entries to only include registered users
            leaderboardEntries = leaderboardEntries.filter(entry => 
                entry.User && registeredUserSet.has(entry.User.toLowerCase())
            );

            // Build the output text
            let output = `**${selectedConfig.name}**\n`;
            output += `**Leaderboard ID:** ${selectedConfig.leaderboardId}\n\n`;
            output += '**User Highscores:**\n\n';

            // Display entries
            if (leaderboardEntries.length > 0) {
                const displayEntries = leaderboardEntries.slice(0, 15);
                for (const entry of displayEntries) {
                    output += formatEntry(entry) + '\n';
                }
            } else {
                output += 'No leaderboard entries found for your users.';
            }

            // Fetch game info for thumbnail using the actual game ID
            const raAPI = new RetroAchievementsAPI(process.env.RA_USERNAME, process.env.RA_API_KEY);
            const gameInfo = await raAPI.getGameInfo(selectedConfig.gameId);
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Arcade Highscores')
                .setDescription(output)
                .setFooter({ text: 'Data provided by RetroAchievements.org' });

            if (gameInfo?.ImageIcon) {
                embed.setThumbnail(`https://retroachievements.org${gameInfo.ImageIcon}`);
            }

            // Delete loading message and send results
            await loadingMessage.delete();
            await message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Arcade command error:', error);
            await message.reply('Error fetching arcade leaderboard. The game or leaderboard might not be available.');
        }
    }
};
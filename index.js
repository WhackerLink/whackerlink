import express from "express";
import basicAuth from "express-basic-auth";
import session from "express-session";
import http from "http";
import {Server as SocketIOServer} from "socket.io";
import axios from 'axios';
import fs from "fs";
import yaml from "js-yaml";
import {google} from 'googleapis';
import * as https from "https";

const socketsStatus = {};
const grantedChannels = {};
const grantedRids = {};
const affiliations = [];
let regDenyCount = {};

const configFilePathIndex = process.argv.indexOf('-c');
if (configFilePathIndex === -1 || process.argv.length <= configFilePathIndex + 1) {
    console.error('Please provide the path to the configuration file using -c argument.');
    process.exit(1);
}

const configFilePath = process.argv[configFilePathIndex + 1];

try {
    const configFile = fs.readFileSync(configFilePath, 'utf8');
    const config = yaml.load(configFile);

    const networkName = config.system.networkName;
    const networkBindAddress = config.system.networkBindAddress;
    const networkBindPort = config.system.networkBindPort;
    const fullPath = config.paths.fullPath;
    const rconLogins = config.paths.rconLogins;
    const serviceAccountKeyFile = config.paths.sheetsJson;
    const sheetId = config.configuration.sheetId;
    const externalPeerEnable = config.peer.externalPeerEnable;
    const grantDenyOccurrence = config.configuration.grantDenyOccurrence;
    const enableDiscord = config.configuration.discordWebHookEnable;
    const discordWebHookUrl = config.configuration.discordWebHookUrl;
    const discordVoiceG = config.discord.voiceGrant;
    const discordVoiceR = config.discord.voiceRequest;
    const discordAffG = config.discord.affiliationGrant;
    const discordAffR = config.discord.affiliationRequest;
    const discordRegG = config.discord.regGrant;
    const discordRegR = config.discord.regRequest;
    const discordRegD = config.discord.regDeny;
    const discordRegRfs = config.discord.regRefuse;
    const discordPage = config.discord.page;
    const discordInhibit = config.discord.inhibit;
    const discordEmerg = config.discord.emergencyCall;
    const discordVoiceD = config.discord.emergencyCall;
    const useHttps = config.configuration.httpsEnable || false;

    // const rconUsername = config.peer.username;
    // const rconPassword = config.peer.password;
    // const rconRid = config.peer.rid;
    // const rconChannel = config.peer.channel;
    // const metaData = config.peer.metaData;
    // const rconEnable = config.peer.rconEnable;

    console.log('Network Name:', networkName);
    console.log('HTTPS Enable:', useHttps);
    console.log('Network Bind Address:', networkBindAddress);
    console.log('Network Bind Port:', networkBindPort);
    console.log('Full Path:', fullPath);
    console.log('RCON Logins Path:', rconLogins);
    console.log('Sheets JSON Path:', serviceAccountKeyFile);
    console.log('Sheet ID:', sheetId);
    console.log('grantDenyOccurrence:', grantDenyOccurrence);
    console.log('External Peer Enable:', externalPeerEnable);

    if (grantDenyOccurrence < 3){
        console.log("grantDenyOccurrence can not be lower than three");
        throw Error;
    }
    // console.log('Username:', username);
    // console.log('Password:', password);
    // console.log('RID:', rid);
    // console.log('Channel:', channel);
    // console.log('Meta Data:', metaData);
    // console.log('RCON Enable:', rconEnable);

    const httpApp = express();
    const httpServer = http.createServer(httpApp);
    const httpIo = new SocketIOServer(httpServer);

    const httpsOptions = {
        key: fs.readFileSync('./ssl/server.key'),
        cert: fs.readFileSync('./ssl/server.cert')
    };

    const httpsApp = express();
    const httpsServer = https.createServer(httpsOptions, httpsApp);
    const httpsIo = new SocketIOServer(httpsServer);

    const app = useHttps ? httpsApp : httpApp;
    const server = useHttps ? httpsServer : httpServer;
    const io = useHttps ? httpsIo : httpIo;

    const googleSheetClient = await getGoogleSheetClient();

    const loginsFile = fs.readFileSync(rconLogins);
    const adminUsers = JSON.parse(loginsFile);

    app.use(session({
        secret: "super_secret_password!2",
        resave: false,
        saveUninitialized: true
    }));

    const auth = basicAuth({
        users: adminUsers,
        challenge: true,
        unauthorizedResponse: "Unauthorized",
    });

    app.set("view engine", "ejs");
    app.use("/files", express.static("public"));
    app.get("/" , async (req , res)=>{
        try {
            const sheetTabs = await getSheetTabs(googleSheetClient, sheetId);
            const zoneData = [];
            for (const tab of sheetTabs) {
                const tabData = await readGoogleSheet(googleSheetClient, sheetId, tab, "A:B");
                zoneData.push({ zone: tab, content: tabData });
            }
            res.render("index", {zoneData, networkName});
        } catch (error) {
            console.error("Error fetching sheet data:", error);
            res.status(500).send("Error fetching sheet data");
        }
    });
    app.get("/radio" , (req , res)=>{
        res.render("radio", {selected_channel: req.query.channel, rid: req.query.rid, mode: req.query.mode, zone: req.query.zone});
    });
    app.get("/unication" , (req , res)=>{
        res.render("g5", {selected_channel: req.query.channel, rid: req.query.rid, mode: req.query.mode, zone: req.query.zone, networkName: networkName});
    });
    app.get("/g5" , async (req , res)=>{
        try {
            const sheetTabs = await getSheetTabs(googleSheetClient, sheetId);
            const zoneData = [];
            for (const tab of sheetTabs) {
                const tabData = await readGoogleSheet(googleSheetClient, sheetId, tab, "A:B");
                zoneData.push({ zone: tab, content: tabData });
            }
            res.render("uniLanding", {zoneData, networkName});
        } catch (error) {
            console.error("Error fetching sheet data:", error);
            res.status(500).send("Error fetching sheet data");
        }
    });
    app.get("/console", async (req, res) => {
        try {
            const sheetTabs = await getSheetTabs(googleSheetClient, sheetId);
            const zoneData = [];
            for (const tab of sheetTabs) {
                const tabData = await readGoogleSheet(googleSheetClient, sheetId, tab, "A:B");
                zoneData.push({ zone: tab, content: tabData });
            }
            res.render("console", {zoneData, networkName});
        } catch (error) {
            console.error("Error fetching sheet data:", error);
            res.status(500).send("Error fetching sheet data");
        }
    });
    app.get("/sys_view" , (req , res)=>{
        res.render("systemView", {networkName});
    });
    app.get("/sys_view/admin",auth, (req , res)=>{
        res.render("adminView", {networkName});
    });
    app.get("/affiliations" , (req , res)=>{
        res.render("affiliations", {affiliations, networkName});
    });
    app.get("/tones" , async (req , res)=>{
        try {
            const sheetTabs = await getSheetTabs(googleSheetClient, sheetId);
            const zoneData = [];
            for (const tab of sheetTabs) {
                const tabData = await readGoogleSheet(googleSheetClient, sheetId, tab, "A:B");
                zoneData.push({ zone: tab, content: tabData });
            }
            res.render("tones", {zoneData, networkName});
        } catch (error) {
            console.error("Error fetching sheet data:", error);
            res.status(500).send("Error fetching sheet data");
        }
    });


    async function sendDiscord(message) {
        const webhookUrl = discordWebHookUrl;

        const embed = {
            title: 'Last Heard',
            description: message,
            color: 0x3498db,
            timestamp: new Date().toISOString()
        };

        const data = {
            embeds: [embed]
        };

        try {
            const response = await axios.post(webhookUrl, data);
            console.log('Webhook sent successfully:', response.data);
        } catch (error) {
            console.error('Error sending webhook:', error.message);
        }
    }

    function getDaTime(){
        const currentDate = new Date();
        const cdtOptions = {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        };
        return currentDate.toLocaleString('en-US', cdtOptions);
    }
    function removeAffiliation(rid) {
        const index = affiliations.findIndex(affiliation => affiliation.rid === rid);
        if (index !== -1) {
            affiliations.splice(index, 1);
        }
        // affiliations.forEach(affiliation => {
        //     console.log(affiliation);
        // });
        io.emit('AFFILIATION_LOOKUP_UPDATE', affiliations);
    }
    function addAffiliation(rid, channel){
        affiliations.push({ rid: rid, channel: channel });
        io.emit('AFFILIATION_LOOKUP_UPDATE', affiliations);
    }
    function getAffiliation(rid) {
        const affiliation = affiliations.find(affiliation => affiliation.rid === rid);
        return affiliation ? affiliation.channel : false;
    }
    function forceGrant(data){
        data.stamp = getDaTime();
        io.emit("VOICE_CHANNEL_GRANT", data);
        console.log(`FORCED VOICE_CHANNEL_GRANT GIVEN TO: ${data.rid} ON: ${data.channel}`);
        if (enableDiscord && discordVoiceG) {
            sendDiscord(`Voice Transmission from ${data.rid} on ${data.channel}`);
        }
        grantedChannels[data.channel] = true;
        grantedRids[data.rid] = true;
    }
    io.on("connection", function (socket) {
        const socketId = socket.id;
        socketsStatus[socket.id] = {};

        socket.on("voice", function (data) {
            var newData = data.split(";");
            newData[0] = "data:audio/wav;";
            newData = newData.join(";");

            const senderChannel = socketsStatus[socketId].channel;

            for (const id in socketsStatus) {
                const recipientChannel = socketsStatus[id].channel;

                if (id != socketId && !socketsStatus[id].mute && socketsStatus[id].online && senderChannel === recipientChannel)
                    socket.broadcast.to(id).emit("send", {newData: newData, rid: socketsStatus[id].username, channel: socketsStatus[id].channel});
            }
        });

        socket.on("userInformation", function (data) {
            socketsStatus[socketId] = data;
            io.sockets.emit("usersUpdate", socketsStatus);
        });

        socket.on("AFFILIATION_LIST_REQUEST", function(){
            io.emit('AFFILIATION_LOOKUP_UPDATE', affiliations);
        });

        socket.on("VOICE_CHANNEL_REQUEST", function (data){
            console.log(`VOICE_CHANNEL_REQUEST FROM: ${data.rid} TO: ${data.channel}`);
            const cdtDateTime = getDaTime();
            data.stamp = cdtDateTime;
            if (enableDiscord && discordVoiceR) {
                sendDiscord(`Voice Request from ${data.rid} on ${data.channel} at ${data.stamp}`);
            }
            io.emit("VOICE_CHANNEL_REQUEST", data);
            setTimeout(function (){
                let integerNumber = parseInt(data.rid);
                if (!Number.isInteger(integerNumber)) {
                    data.stamp = cdtDateTime;
                    io.emit("VOICE_CHANNEL_DENY", data);
                    console.log("Invalid RID type");
                    return;
                }
                if (grantedChannels[data.channel] === undefined) {
                    grantedChannels[data.channel] = false;
                }
                if (grantedRids[data.rid] === undefined){
                    grantedRids[data.rid] = false;
                }
                let grant = false;
                const randomNum = Math.floor(Math.random() * 5) + 1;
                grant = randomNum !== 3;
                if (grant && !grantedChannels[data.channel]) {
                    data.stamp = cdtDateTime;
                    io.emit("VOICE_CHANNEL_GRANT", data);
                    console.log(`VOICE_CHANNEL_GRANT GIVEN TO: ${data.rid} ON: ${data.channel}`);
                    if (enableDiscord && discordVoiceG) {
                        sendDiscord(`Voice Transmission from ${data.rid} on ${data.channel} at ${data.stamp}`);
                    }
                    grantedChannels[data.channel] = true;
                    grantedRids[data.rid] = true;
                } else {
                    data.stamp = cdtDateTime;
                    io.emit("VOICE_CHANNEL_DENY", data);
                    console.log(`VOICE_CHANNEL_DENY GIVEN TO: ${data.rid} ON: ${data.channel}`);
                    if (enableDiscord && discordVoiceD) {
                        sendDiscord(`Voice Deny from ${data.rid} on ${data.channel} at ${data.stamp}`);
                    }
                    grantedChannels[data.channel] = false;
                }

            }, 500);
        });

        socket.on("RELEASE_VOICE_CHANNEL", function (data){
            data.stamp = getDaTime();
            console.log(`RELEASE_VOICE_CHANNEL FROM: ${data.rid} TO: ${data.channel}`);
            io.emit("VOICE_CHANNEL_RELEASE", data);
            grantedRids[data.rid] = false;
            grantedChannels[data.channel] = false;
        });

        socket.on("disconnect", function (data) {
            if (socketsStatus[socketId].username) {
                removeAffiliation(socketsStatus[socketId].username);
            }
            delete socketsStatus[socketId];
        });

        socket.on("CHANNEL_AFFILIATION_REQUEST", function (data){
            data.stamp = getDaTime();
            io.emit("CHANNEL_AFFILIATION_REQUEST", data);
            if (enableDiscord && discordAffR) {
                sendDiscord(`Affiliation Grant to ${data.rid} on ${data.channel} at ${data.stamp}`);
            }
            setTimeout(function (){
                io.emit("CHANNEL_AFFILIATION_GRANTED", data);
                if (enableDiscord && discordAffG) {
                    sendDiscord(`Affiliation Grant to ${data.rid} on ${data.channel} at ${data.stamp}`);
                }
                if (!getAffiliation(data.rid)){
                    console.log("AFFILIATION GRANTED TO: " + data.rid + " ON: " + data.channel);
                    addAffiliation(data.rid, data.channel, data.stamp = getDaTime());
                } else {
                    console.log("AFFILIATION GRANTED TO: " + data.rid + " ON: " + data.channel + " AND REMOVED OLD AFF");
                    removeAffiliation(data.rid);
                    addAffiliation(data.rid, data.channel);
                }
            },1500);
        });
        socket.on("REMOVE_AFFILIATION", function (data){
            data.stamp = getDaTime();
            removeAffiliation(data.rid);
            console.log("AFFILIATION REMOVED: " + data.rid + " ON: " + data.channel);
            io.emit("REMOVE_AFFILIATION_GRANTED", data);
        });

        socket.on("EMERGENCY_CALL", function (data){
            if (enableDiscord && discordEmerg) {
                sendDiscord(`Affiliation Grant to ${data.rid} on ${data.channel} at ${data.stamp}`);
            }
            data.stamp = getDaTime();
            console.log("EMERGENCY_CALL FROM: " + data.rid + " ON: " + data.channel)
            io.emit("EMERGENCY_CALL", data);
        });

        socket.on("RID_INHIBIT", async function(data) {
            if (enableDiscord && discordInhibit) {
                sendDiscord(`Inihbit sent to ${data.rid} on ${data.channel} at ${data.stamp}`);
            }
            data.stamp = getDaTime();
            const ridToInhibit = data.channel;
            const ridAcl = await readGoogleSheet(googleSheetClient, sheetId, "rid_acl", "A:B");
            io.emit("RID_INHIBIT", data);
            const matchingIndex = ridAcl.findIndex(entry => entry[0] === ridToInhibit);

            if (matchingIndex !== -1) {
                ridAcl[matchingIndex][1] = '0';
                await updateGoogleSheet(googleSheetClient, sheetId, "rid_acl", "A:B", ridAcl);
                console.log(`RID_INHIBIT: ${ridToInhibit}`);
            }
        });

        socket.on("RID_INHIBIT_ACK", function (data){
            io.emit("RID_INHIBIT_ACK", data);
        });

        socket.on("RID_UNINHIBIT_ACK", function (data){
            io.emit("RID_UNINHIBIT_ACK", data);
        });

        socket.on("RID_UNINHIBIT", async function (data){
            data.stamp = getDaTime();
            const ridToUnInhibit = data.channel;
            const ridAcl = await readGoogleSheet(googleSheetClient, sheetId, "rid_acl", "A:B");
            io.emit("RID_UNINHIBIT", data);
            const matchingIndex = ridAcl.findIndex(entry => entry[0] === ridToUnInhibit);

            if (matchingIndex !== -1) {
                ridAcl[matchingIndex][1] = '1';
                await updateGoogleSheet(googleSheetClient, sheetId, "rid_acl", "A:B", ridAcl);
                console.log(`RID_UNINHIBIT: ${ridToUnInhibit}`);
            }
        });

        socket.on("INFORMATION_ALERT", function(data){
            io.emit("INFORMATION_ALERT", data);
            forceGrant(data);
            setTimeout(function (){
                io.emit("VOICE_CHANNEL_RELEASE", data);
            }, 1500);
        });

        socket.on("CANCELLATION_ALERT", function(data){
            io.emit("CANCELLATION_ALERT", data);
            forceGrant(data);
            setTimeout(function (){
                io.emit("VOICE_CHANNEL_RELEASE", data);
            }, 1500);
        });

        socket.on("REG_REQUEST", async function (rid){
            io.emit("REG_REQUEST", rid);
            String.prototype.isNumber = function(){return /^\d+$/.test(this);}
            let ridAcl = await readGoogleSheet(googleSheetClient, sheetId, "rid_acl", "A:B");
            const matchingEntry = ridAcl.find(entry => entry[0] === rid);
            const denyCount = regDenyCount[rid] || 0;
            if (enableDiscord && discordRegR){
                sendDiscord(`Reg Request: ${rid}`);
            }
            setTimeout(function (){
                if (rid.isNumber()) {
                    if (matchingEntry) {
                        const inhibit = matchingEntry[1];
                        if (inhibit === '1') {
                            if (enableDiscord && discordRegG){
                                sendDiscord(`Reg grant: ${rid}`);
                            }
                            io.emit("REG_GRANTED", rid);
                            console.log("REG_GRANTED: " + rid);
                        } else {
                            io.emit("RID_INHIBIT", {channel: rid, rid: "999999999"});
                        }
                    } else {
                        if (denyCount >= 3){
                            if (enableDiscord && discordRegRfs){
                                sendDiscord(`Reg refuse: ${rid}`);
                            }
                            io.emit("REG_REFUSE", rid);
                        } else {
                            if (enableDiscord && discordRegD){
                                sendDiscord(`Reg deny: ${rid}`);
                            }
                            io.emit("REG_DENIED", rid);
                            regDenyCount[rid] = denyCount + 1;
                        }
                    }
                } else {
                    if (denyCount >= 3){
                        if (enableDiscord && discordRegRfs){
                            sendDiscord(`Reg refuse: ${rid}`);
                        }
                        io.emit("REG_REFUSE", rid);
                    } else {
                        if (enableDiscord && discordRegD){
                            sendDiscord(`Reg deny: ${rid}`);
                        }
                        io.emit("REG_DENIED", rid);
                        regDenyCount[rid] = denyCount + 1;
                    }
                }
            }, 1500);
        });
        socket.on("RID_PAGE", function(data){
            data.stamp = getDaTime();
            io.emit("PAGE_RID", data);
        });
        socket.on("RID_PAGE_ACK", function(data){
            data.stamp = getDaTime();
            io.emit("PAGE_RID_ACK", data);
        });
        socket.on("FORCE_VOICE_CHANNEL_GRANT", function(data){
            forceGrant(data);
        });
        socket.on("PEER_LOGIN_REQUEST", function(data){
            //Future login handling for peers
        });
    });

    async function getGoogleSheetClient() {
        const auth = new google.auth.GoogleAuth({
            keyFile: serviceAccountKeyFile,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const authClient = await auth.getClient();
        return google.sheets({
            version: 'v4',
            auth: authClient,
        });
    }
    async function getSheetTabs(googleSheetClient, sheetId) {
        const res = await googleSheetClient.spreadsheets.get({
            spreadsheetId: sheetId,
            ranges: [],
            includeGridData: false,
        });

        const sheets = res.data.sheets;
        const tabs = sheets.map(sheet => sheet.properties.title);

        const tabsToRemove = ["rid_acl"];
        return tabs.filter(tab => !tabsToRemove.includes(tab));
    }

    async function readGoogleSheet(googleSheetClient, sheetId, tabName, range) {
        const res = await googleSheetClient.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `${tabName}!${range}`,
        });
        return res.data.values;
    }

    async function writeGoogleSheet(googleSheetClient, sheetId, tabName, range, data) {
        await googleSheetClient.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${tabName}!${range}`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                "majorDimension": "ROWS",
                "values": data
            },
        })
    }
    async function updateGoogleSheet(googleSheetClient, sheetId, tabName, range, data) {
        await googleSheetClient.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${tabName}!${range}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                "majorDimension": "ROWS",
                "values": data
            },
        });
    }

    server.listen(networkBindPort, networkBindAddress, () => {
        const protocol = useHttps ? 'https' : 'http';
        console.log(`${networkName} is running on ${protocol}://${networkBindAddress}:${networkBindPort}`);
    });

} catch (error) {
    console.error('Error starting. Maybe config file?: ', error.message);
}
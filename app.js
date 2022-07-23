'use strict';

const Koa = require('koa')
const Router = require('@koa/router')
const cors = require('@koa/cors');
const Fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))
const fs = require('fs');
const util = require( "util");
const { Pool } = require('pg');

const app = new Koa()
const router = new Router()

const getPool = require( './dbPool.js')
app.pool =  getPool.dbPool()

const videoDataFile = require( "./videoData.js")
let videoData = videoDataFile.data()

let useLocalStorage = false;

let frameId = 41;
let videoFile = '/Users/stangregg/Documents/Sports3-D_LLC/development/json_dumps/video_2022-07-19.json';

const goodArchiveFile = require( "./goodArchives.js")
let goodArchiveList = goodArchiveFile.goodArchives()
let scoreArchiveList = goodArchiveFile.scoreArchives()

let defaultCleanPt = {
    name: false,
    x: false,
    y: false,
    z: false,
    vx: false,
    vy: false,
    vz: false,
    tick: false,
    time_sec: false
}

let lastCleanData = false;

function cleanPts( pts)
{
    let local_Pts = false;
    let cleanedPts = [];
    if( Array.isArray( pts)){
        local_Pts = pts;
    }
    else {
        local_Pts = [ pts];
    }
    try {
        local_Pts.forEach(pt => {
            let cleanPt = deepClone(defaultCleanPt);

            if( !pt.hasOwnProperty( "name") ||  ( typeof pt.name === 'undefined')) {
                console.log( "Not Name in pt", pt);
            }
            else {
                cleanPt.name = pt.name;
            }
            if ( pt.hasOwnProperty( 'point')) {
                if( isEmpty( pt.point)){
                    cleanPt.x = false;
                    cleanPt.y = false;
                    cleanPt.z = false;
                }
                else {
                    cleanPt.x = pt.point[0];
                    cleanPt.y = pt.point[1];
                    cleanPt.z = pt.point[2];
                }
            } else {
                cleanPt.x = pt.x;
                cleanPt.y = pt.y;
                cleanPt.z = pt.z;
                cleanPt.vx = pt.vx;
                cleanPt.vy = pt.vy;
                cleanPt.vz = pt.vz;
                cleanPt.tick = pt.tick;
                cleanPt.time_sec = pt.time_sec;
            }

            cleanedPts.push(cleanPt);
        })
    }
    catch( error){
        console.error( error);
    }
    return cleanedPts;
}



function isEmpty(value) {
    return (value === false) || ( typeof value == 'string' && !value.trim())  || (typeof value == 'undefined') || (value === null);
}

function deepClone( source){
    let target = JSON.parse(JSON.stringify(source));
    return target;
}

function arraysAreEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length !== b.length) return false;

    // If you don't care about the order of the elements inside
    // the array, you should sort both arrays here.
    // Please note that calling sort on an array will modify that array.
    // you might want to clone your array first.
/*    if( JSON.stringify( a) === JSON.stringify(b))
        return true;
*/
    if( Array.isArray(a) !== Array.isArray(b)) return false;
    if( Array.isArray(a) && Array.isArray(b)) {
        for (var i = 0; i < a.length; ++i) {
            if (!arraysAreEqual(a[i], b[i])) {
                return false;
            }
        }
    }

    return true;
}

router.get( '/', (ctx) => {
    ctx.body = 'Hello World';
    console.log('Hello World');
})


class HTTPResponseError extends Error {
    constructor(response, ...args) {
        super(`HTTP Error Response: ${response.status} ${response.statusText}`, ...args);
        this.response = response;
    }
}
const checkStatus = response => {
    if (response.ok) {
        // response.status >= 200 && response.status < 300
        return response;
    } else {
        throw new HTTPResponseError(response);
    }
}

let dataQuery = "select l.logid, l.logtime,l.archivefileid,f.archivefilename, l.logresponse, from p3d_ds_log l, p3d_archive_file f where  l.frame_id="+frameId+" and l.archivefileid=f.archivefileid order by l.logtime";

router.get( '/getLogDataTest', async (ctx) => {
    const { rows } = await ctx.app.pool.query( dataQuery);
    ctx.body = rows;

})

async function getLogData( params) {
    try {
        let range = false;

        if( isEmpty( params.frame_id_or_start_range)) {
            console.log( "No Start range for frame_id for query");
            return false;
        }
        if( Number.isInteger( Number(params.frame_id_or_start_range)) &&  (parseInt( params.frame_id_or_start_range, 10) > 0)) {
            frameId = parseInt( params.frame_id_or_start_range, 10);
            range = "( l.frame_id = " + parseInt( params.frame_id_or_start_range, 10) +  ")";
        }
        else {
            range = "( l.logtime >= '" + params.frame_id_or_start_range + "'";

            if( !isEmpty( params.end_range)) {
                range += " and l.logtime <= '" + params.end_range + "'";
            }
            range += ")";
        }

//        const rows  = fs.readFileSync('/parsed_score_data.'+ params.start_range+'.json');


      //  let queryString = "select l.logcreatetime,l.archivefileid,f.archivefilename, l.logresponse from p3d_ds_log l, p3d_archive_file f where "+range+" and l.archivefileid=f.archivefileid order by l.logcreatetime";
        let queryString = "select l.frame_id,l.logtime,l.archivefileid,f.archivefilename, l.logresponse, l.logid from p3d_ds_log l, p3d_archive_file f where "+range+" and l.archivefileid=f.archivefileid order by l.logtime";

        const rows  = await app.pool.query( queryString );

        return rows;
    }
    catch( error) {
        console.error( error);
    }

}

const cleanPlayDataList = [
    "TRK_HIT_NET",
    "TRK_SERVE",
    "TRK_DONE_IN",
    "TRK_NEW_SIDE",
    "TRK_DONE_OUT"
//            "TRK_LAST"
]

const isAce = [ {action : "serve"}, {action : "net plane"}, { action : "cross_net"}, {action : "hit floor inbounds"}];



function getCleanPlayData( rawData) {
    let trajCount = 1;
    let errorAction = false
    let BSideServes = [];

    try {
        let cleanPlayData = [];

        let playAction = false;
        rawData.rows.forEach( row => {
            let traj = row.logresponse;
            ++trajCount;
            if( playAction !== false) {
                console.log("Skipped Archive", playAction);
            }
            playAction = false
            let defaultPlayAction = {
                logTime: row.logtime,
                archiveFileId: row.archivefileid,
                archiveFileName: row.archivefilename,
                logId: row.logid,
                frameId: row.frame_id,
                plays: []
            };

            errorAction = defaultPlayAction;
            let serveOccurred = false;
            let validated_index = false;
            if (typeof traj[0] !== 'undefined') {
                if (traj[0].hasOwnProperty('events')) {
                    if (typeof traj[0].events[0] !== 'undefined') {
                        if (traj[0].events[0] == 'STREAM_START') {
                            if (typeof traj[1] !== 'undefined') {
                                if (traj[1].hasOwnProperty('events')) {
                                    if (typeof traj[1].events[0] !== 'undefined') {
                                        if (traj[1].events[0] == 'SIM_START') {
                                            validated_index = 2;
                                        }
                                    }
                                }
                            }
                        } else if (traj[0].events[0] == 'SIM_START') {
                            validated_index = 1;
                            if (playAction !== false) {
                                console.error("SIM_START before SIM_END");
                            }
                        } else if (traj[0].events[0] == 'SIM_END') {
                            if (playAction === false) {
                                console.log("empty SIM_START to SIM START BLOCK");
                            } else {
                                if( serveOccurred === false) {
                                    console.log("No Serve", playAction);
                                }
                                cleanPlayData.push(playAction);
                                playAction = false;
                            }
                        }
                    }
                }

                if (validated_index !== false) {
                    if (typeof traj[validated_index] !== 'undefined') {
                        for (let index = validated_index; index < traj.length; ++index) {
                            let trajItem = traj[index];
                            if( trajItem.N == 0) {
                                console.log( "Skipped empty trajectory", trajItem);
                                continue;
                            }

                            let currentPlay = {
                                id: false,
                                trajName: false,
                                tick: false,
                                events: false,
                                eventPts: false,
                                calcPt: false,
                                allPts: false,
                            };
                            errorAction = trajItem;

                            if (trajItem.hasOwnProperty( "events") && (trajItem.events != null) &&
                                Array.isArray(trajItem.events) && (trajItem.events.length > 0)) {
                                if (trajItem.events[0] == 'SIM_END') {
                                    if (playAction === false) {
                                        console.log("empty SIM_START to SIM START BLOCK", row.archivefileid,  row.archivefilename,  row.logtime);
                                    } else {
                                        if ((currentPlay.events.length == 1) && (currentPlay.events[0] == "TRK_SERVE")) {
                                            console.log("Only TRK_SERVE Block" + JSON.stringify(playAction))
                                        } else {
                                            if (playAction === false) {
                                                playAction = deepClone(defaultPlayAction);
                                            }
                                            playAction.plays.push[currentPlay];
                                            if( serveOccurred === false) {
                                                console.log("No Serve", playAction);
                                            }
                                            cleanPlayData.push(playAction);
                                            playAction = false;
                                        }
                                    }
                                    break;
                                } else if (trajItem.events.every(event => cleanPlayDataList.includes(event))) {
                                    if (trajItem.tick > 0) {

                                        if ((trajItem.events[0] == "TRK_SERVE") || (playAction === false)){
                                            serveOccurred = true;
                                            /*
                                            if( trajItem.hasOwnProperty( "eventPts") && !isEmpty(trajItem.eventPts) || ( trajItem.eventPts[0].point[0] > 50) || (trajItem.pts[0].x > 50)) {
                                                if(( trajItem.pts[0].vx < 0) || (trajItem.vx < 0)) {
                                                    console.log("B side serve", row.archivefileid, row.archivefilename, row.logid, trajItem);
                                                    let tmp = ["B side serve", row.archivefileid, row.archivefilename, row.logid, "N:"+trajItem.N, "Tick:"+trajItem.tick,
                                                            "pt.vx="+ trajItem.pts[0].vx,"pt.x="+trajItem.pts[0].x, "evt.x="+trajItem.eventPts[0].point[0] ];
                                                    BSideServes.push(tmp);
                                                }
                                            }
                                            */
                                        }

                                        let dupe = false;
                                        if(playAction !== false) {
                                            errorAction = playAction;
                                            playAction.plays.every( play => {
                                                if(( play.tick == trajItem.tick) && Array.isArray(play.events) &&
                                                        play.events.some( evt => trajItem.events.includes( evt))){
                                                    dupe = true;
                                                    return false;
                                                }
                                                return true;
                                            })
                                        }

                                        if (dupe) {
                                            /*
                                            if(( playAction.plays.length >= 1) && (playAction.plays[ playAction.plays.length - 1].length == 1) &&
                                               (playAction.plays[playAction.plays.length - 1].events[0] == trajItem.events[0]) &&
                                               (playAction.plays[ playAction.plays.length - 1].tick == trajItem.tick)) {
                                            */

                                                console.log('Extra Initial removed old:', row.archivefileid,  row.archivefilename,  row.logid, playAction.plays[ playAction.plays.length - 1], trajItem);
                                                playAction.plays.splice( playAction.plays.length - 1, 1);
                                           /*
                                            }
                                            */
                                        }

                                        if (playAction === false) {
                                            playAction = deepClone(defaultPlayAction);
                                            errorAction = playAction;
                                        }

                                        currentPlay.events = trajItem.events;
                                        currentPlay.eventPts = cleanPts(trajItem.eventPts);

                                    } else {
                                        console.log('Duplicate or Zero Tick', row.archivefileid,  row.archivefilename,  row.logid, trajItem);
                                    }
                                } else {
                                    console.log('Did not find all of',row.archivefileid,  row.archivefilename,  row.logid, trajItem.events);
                                }
                            }
                            if (!serveOccurred) {
                                console.log('No Serve Found',row.archivefileid,  row.archivefilename,  row.logtime, trajItem);
                               // break;
                            }
                            if( true) {
                                if (trajItem.hasOwnProperty('pts') && (typeof trajItem.pts !== "undefined") && ( trajItem.pts != null)) {
                                    currentPlay.allPts = cleanPts(trajItem.pts);
                                }
                                if (trajItem.hasOwnProperty('x') && (typeof trajItem.x !== "undefined") && ( trajItem.x != null)) {
                                    currentPlay.calcPt = cleanPts(trajItem);
                                }
                                currentPlay.tick = trajItem.tick;
                                currentPlay.id = trajItem.id;
                                currentPlay.trajName = trajItem.name;
                                if (playAction === false) {
                                    playAction = deepClone(defaultPlayAction);
                                    playAction.plays.push(currentPlay);
                                }
                                else {
                                    errorAction = playAction;
                                    let dupe = false;
                                    let dupePlay = false;
                                    playAction.plays.every( play => {
                                       if( util.isDeepStrictEqual( currentPlay, play)){
                                            dupe = true;
                                            dupePlay = play;
                                            return false;
                                        }
                                        return true;
                                    })
                                    if( dupe) {
                                        console.log( "Duplicate play skipped",row.archivefileid,  row.archivefilename,  row.logtime, currentPlay, dupePlay);
                                    }
                                    else {
                                        playAction.plays.push(currentPlay);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
        /*
        let fname = '/Users/stangregg/Documents/Sports3-D_LLC/development/json_dumps/Bsideserves.2022-07-10-'+frameId+'.json'
        let tmpS = JSON.stringify(  BSideServes );
        fs.writeFileSync( fname, tmpS);

         */

        return cleanPlayData;
    } catch (error) {
        console.error( error);
        const errorBody =  error.message;
        let errorMess = '{"message": "'+errorBody +'"}';
        console.error(errorMess);
        return errorMess;
    }

}
const sportHasGames = [
    "tennis"
]

let match = {
    sets : [],
    score: [ 0, 0],
    set: 0,
    hasGames : false,
    entities : [],
    sport : "volleyball",
    state : "none",
    active: false
};

function resetSet()
{
    let set =  {
        aces: [0, 0],
        kills: [0, 0],
        service_errors: [],
        score: [0, 0],
        active: false
    }
    if( match.hasGames !== false){
        let game = {
            score: [0, 0],
            playActions: [],
            active: 'false',
            points: []
        }
        set.games = [ game, game]
        set.game = 1;
    }
    else {
        set.playActions = [];
        set.points = [];
    }
    return set;
}

function initMatch()
{
    try {
        match.set = 1;
        if( match.sport in sportHasGames)
            match.hasGames = true;
        match.entities = [ 'Steve', 'Chris'];
        match.active = true;
        let set = resetSet();

        match.sets.push( set)
        set.active = true;
        match.sets.push( set)
    }
    catch( error) {
        console.error( error)
    }
    return 0;
}

function otherSide( side)
{
    return side == 1 ? 0 : 1;
}

function addPoint( side){
    if( match.hasGames) {
        ++match.sets[ match.set].games[ match.sets [match.set].game].score[ side]
    }
    else {
        ++match.sets[match.set].score[ side]
    }
}

function scorePoint(play_state)
{
    let side_out = null;
    try{
        if( play_state.serving_side == play_state.net_side) {
            if( play_state.state == 'serve'){
                ++match.sets[match.set].service_errors[play_state.serving_side]
                play_state.side_out = true;
            }
            else {
                ++match.sets[match.set].kills[ play_state.serving_side]
                play_state.side_out = false;
            }
            addPoint( otherSide( play_state.serving_side))
        }
        else {
            if( play_state.state == 'serve'){
                if( arraysAreEqual( play_state.plays, isAce)) {
                    ++match.sets[match.set].aces[play_state.serving_side]
                }
                addPoint( play_state.serving_side)
                play_state.side_out = false;
            }
            else {
                addPoint( play_state.net_side)
                ++match.sets[match.set].kills[play_state.net_side]
                play_state.side_out = true;
            }
        }

        play_state.point_winner = true;
        match.sets[match.set].playActions.push( deepClone( play_state))
        resetPlayState( play_state.side_out ? otherSide( play_state.serving_side): play_state.serving_side)
    }
    catch( error) {
        console.error( error)
    }
}


let playState = resetPlayState( 0)

function resetPlayState( serving_side) {
    let play_state =
        {
            serving_side: serving_side,
            state: "none",
            net_side: serving_side,
            plays: [],
            eventPts: [],
            point_winner: false,
            side_out: false,
            active: false
        }
    return play_state;
}


function scoreVolleyball( playActions) {
    try {
        if (match.active === false) {
            initMatch();
        }
        let servering = false;
        playActions.forEach( playAction => {
            playAction.plays.forEach(volley => {
                volley.forEach(event => {
                    switch (event) {
                        case "TRK_SERVE":
                            if( playState.serving) {
                                console.log( "extra serve")
                            }
                            else {
                                playState.state = "serving";
                                playState.plays.push( { action : "serve"});
                                playState.active = true;
                            }
                            break;

                        case "TRK_HIT_NET":
                            playState.plays.push( { action: 'net plane'});
                            break;

                        case "TRK_NEW_SIDE":
                            playState.net_side = playState.net_side == 1 ? 0 : 1;
                            playState.plays.push( { action: 'crossed net'})
                            playState.state = "volley";
                            break;

                        case "TRK_DONE_IN":
                            scorePoint( playState)
                            break;

                        default:
                            console.log("Invalid event: " + event);
                            break;
                    }
                })
            })
        })
    } catch ( error) {
       console.error( error)
    }
}
async function getCleanData( params) {
    try {
        let rawData = false;
        if ( params.hasOwnProperty( "frame_id_or_start_range")) {
            rawData = await getLogData( params);
        }
        if (rawData === false || rawData == undefined || rawData.rowCount <= 0) {
            let errorMess = "No data returned for query " + JSON.stringify( params);
            console.log(errorMess, params);
            return errorMess;
        }

       return getCleanPlayData(rawData);

    } catch (error) {
        console.error(error);
        return error;
    }
}

router.get( '/getMatchData/:frame_id_or_start_range/:end_range*', async (ctx, next) => {
    try {
        let playData = false;
        if( ctx.params.hasOwnProperty( "frame_id_or_start_range")){
            let params = {
                "frame_id_or_start_range" : ctx.params.frame_id_or_start_range,
                "end_range" : (ctx.params.hasOwnProperty( "end_range") ? ctx.params.end_range : false)
            }
            playData = await getCleanData( params);
        }
        if ( playData === false || playData == undefined || playData.rowCount <= 0) {
            let errorMess = JSON.stringify( { "message": "No data returned for query "+ JSON.stringify(  JSON.parse( ctx)) } );
            console.log(errorMess, ctx.params);
            ctx.body = errorMess;
            return;
        }

        lastCleanData = playData
        console.log( playData.length);
        switch( match.sport)
        {
            case "volleyball":
                if( useLocalStorage) {
                    let writeData = JSON.stringify(playData);
                    lastSavedJSONFile = '/Users/stangregg/Documents/Sports3-D_LLC/development/json_dumps/parsed_score_data.' + ctx.params.frame_id_or_start_range + '.json';
                    fs.writeFileSync(lastSavedJSONFile, writeData);
                }
//                scoreVolleyball( playData);
                break;
            default:
                console.error( "Invalid Sport: " + match.sport);
        }

        let jsonMatch = {
            match : match,
            datalength :  playData.length,
            playData : playData
        };
//        ctx.body = jsonMatch;`
        ctx.body = jsonMatch;

    } catch (error) {
        console.error(error);
        ctx.body = error;
    }

})


router.get( '/dudeTest', async (ctx) => {

    var response = await Fetch('https://www.espn.com');

    try {
        checkStatus(response);
//        ctx.body = response.json()

        ctx.body = '{JSONtest:\'dudeTest\'}'
    } catch (error) {
        console.error(error);

        const errorBody =  error.response.text();
        console.error(`Error body: ${errorBody}`);
        ctx.body = 'Error Hello Dude';
    }



})

let lastSavedJSONFile = '/Users/stangregg/Documents/Sports3-D_LLC/development/json_dumps/parsed_score_data.41.json';

function inRange(check, a,b ) {
    let min = Math.min(a, b),
        max = Math.max(a, b);
    let ret = ( check >= min && check <= max);
    return ret;
}



router.get( '/getAllPlotPoints/:archiveId/:tablelength/:tablewidth/:theight/:netxpos', async (ctx, next) => {
    try {
        if (lastCleanData === false) {
            try {
                if ( useLocalStorage && (lastSavedJSONFile !== false)) {
                    const rows = fs.readFileSync(lastSavedJSONFile);
                    lastCleanData = JSON.parse(rows);
                } else {
                    let params = {
                        "frame_id_or_start_range" : frameId,
                        "end_range" : false
                    }
                    let playData = await getCleanData( params);
                    if ( playData === false || playData == undefined || playData.rowCount <= 0) {
                        let errorMess = JSON.stringify( { "message": "No data returned for query "+ JSON.stringify(  JSON.parse( ctx)) } );
                        console.log(errorMess, ctx.params);
                        ctx.body = errorMess;
                        return;
                    }

                    lastCleanData = playData
                }
            }
            catch( error) {
                let errorMess = '{"message" : "No data, request clean data "' + JSON.stringify( ctx.params)+ '"}';
                console.log(errorMess, ctx.params);
                ctx.body = errorMess;
                return;
            }
        }
        let archiveId = ctx.params.archiveId;
        let foundArchive = false;


        lastCleanData.every(archive => {
            if( foundArchive === false) {
                foundArchive = [];
            }

            if( archiveId === 'all') {
                foundArchive.push( archive);
            }
            else if( archiveId == "score") {
                if ( scoreArchiveList.includes( archive.archiveFileName )){
                    foundArchive.push( archive);
                }
            }
            else if( archiveId == "good") {
                if ( scoreArchiveList.includes( archive.archiveFileName ) ||
                         goodArchiveList.includes( archive.archiveFileName)) {
                    foundArchive.push( archive);
                }
            }
            else if (archive.archiveFileId === parseInt(archiveId)) {
                foundArchive.push( archive);
                return false;
            }
            else {
                console.log( "Skipped Points for", archive.archiveFileName)
            }
            return true;
        })

        if ( foundArchive === false) {
            let errorMess = '{"message" : "No data returned for query "}';
            console.log(errorMess, ctx.params);
            ctx.body = errorMess;
            return;
        }

        let tableLength = parseFloat(ctx.params.tablelength);
        let tableWidth = parseFloat(ctx.params.tablewidth);
        let tableHeight = parseFloat(ctx.params.theight);
        let netXPos = parseFloat( ctx.params.netxpos);

        let unitScale = 100;
        let localTableHeight = 77.0;
        let localTableLength = 276.0;
        let localTableWidth = 151.0;
//        let netOffset = -((.5 * tableLength) - (tableLength / 12.0)) * unitScale;
        let originOffset = -2.0;
        let yCenterOffset = -2.5;

        let xScaleFactor = tableLength * unitScale / localTableLength;
        let yScaleFactor = tableWidth * unitScale / localTableWidth;
        let zScaleFactor =  tableHeight * unitScale / localTableHeight;

        //let tableEndPts = [ -localTableLength/2.0 - originOffset, localTableLength/2.0 - originOffset];
        let tableEndPts = [originOffset, localTableLength + originOffset];
        let tableEdges = [-(localTableWidth/2.0) + yCenterOffset, (localTableWidth / 2.0) + yCenterOffset ];

        let floorOffset = -localTableHeight;

        //let xCenterOffset = (localTableLength  - ( (tableLength / 2) - netXPos) * unitScale + originOffset) * xScaleFactor;
        let xCenterOffset =  (( (tableLength / 2) - netXPos) * xScaleFactor) * unitScale + originOffset;
        let plotPoints = [];
        let lastPlotPt = {
            vx: 0,
            vy: 0,
            vz: 0
        };
        let index = 0;
        let lowestY = 999;
        let lowYPoints = false;
        let lowYPlotPoints = false;

        foundArchive.forEach( archive => {

            let startArchive = true;
            let finalPlotPt = false;
            let firstPlotPt = true;
            let ptCount = 0;
            archive.plays.forEach(play => {
                ptCount += play.allPts.length;
                let playStartIndex = index;
                let playEndIndex = index;
                let hasEvents = (play.hasOwnProperty("eventPts") && !isEmpty(play.eventPts) && (play.eventPts.length > 0));
                let playIndex = 0;
                play.allPts.forEach(pt => {
                    let plotPt = {
                        x: (xCenterOffset - pt.x) * xScaleFactor,
                        y: (pt.z + floorOffset) * zScaleFactor,
                        z: (pt.y + yCenterOffset) * yScaleFactor,
                        vx: (pt.vx == 0 ? lastPlotPt.vx : pt.vx * -1),
                        vy: (pt.vz == 0 ? lastPlotPt.vy : pt.vz),
                        vz: (pt.vy == 0 ? lastPlotPt.vz : pt.vy),
                        tick: pt.tick,
                        index: index,
                        trajIndex: playIndex,
                        name: pt.name,
                        trajName: play.trajName,
                        orig_x: pt.x,
                        orig_y: pt.y,
                        orig_z: pt.z

                    }
                    if (hasEvents && (index == playStartIndex)) {
                        plotPt.events = play.events;
                    }
                    if (startArchive) {
                        let dataLabel = {
                            archiveFileId: archive.archiveFileId,
                            archiveFileName: archive.archiveFileName,
                            logTime: archive.logTime,
                            logId: archive.logId,
                            frameId: archive.frameId,
                            ptCount: ptCount,
                            trajCount: archive.plays.length,
                            archiveData: archive,
                            video: false
                        }
                        if(videoData.data.hasOwnProperty( dataLabel.archiveFileName) &&
                            !isEmpty( videoData.data[ dataLabel.archiveFileName])) {
                            dataLabel.video = {
                                "archiveFileName" : dataLabel.archiveFileName,
                                "url": videoData.metadata.url,
                                "videoFileName" : videoData.data[ dataLabel.archiveFileName]
                            }
                        }
                        plotPt.startArchive = true;
                        plotPt.dataLabel = dataLabel;
                        firstPlotPt = plotPt;
                    }
                    ++index;
                    ++playIndex;
                    if ((pt.x >= tableEndPts[0]) && (pt.x <= tableEndPts[1]) &&
                        (pt.y >= tableEdges[0]) && (pt.y <= tableEdges[1])) {
                        if ((plotPt.y < lowestY) && (plotPt.y < 0)) {
                            lowestY = Math.min(lowestY, plotPt.y)
                            lowYPoints = pt;
                            lowYPlotPoints = plotPt;
                        }
                    }

                    startArchive = false;
                    plotPoints.push(plotPt);
                    if ((plotPt.vx != 0) || (plotPt.vy != 0) || (plotPt.vz != 0))
                        lastPlotPt = plotPt;
                    finalPlotPt = plotPt;
                })
                //hasEvents = false;
                if (hasEvents) {
                    play.eventPts.forEach(eventPt => {
                        let newPlotPt = false;
                        if (eventPt.hasOwnProperty("x")) {
                            newPlotPt = {
                                x: (xCenterOffset - eventPt.x) * xScaleFactor,
                                y: (eventPt.z + floorOffset) * zScaleFactor,
                                z: (eventPt.y + yCenterOffset) * yScaleFactor,
                                vx: 0,
                                vy: 0,
                                yz: 0,
                                tick: eventPt.tick,
                                index: 0,
                                trajIndex: 0,
                                name: eventPt.name,
                                trajName: play.trajName,
                                orig_x: eventPt.x,
                                orig_y: eventPt.y,
                                orig_z: eventPt.z
                            }
                        }
                        let ptInserted = false;
                        let playEndIndex = plotPoints.length - 1;
                        let ptIndex = false;
                        try {

                            for (ptIndex = playStartIndex + 1; ptIndex <= playEndIndex; ++ptIndex) {
                                if (newPlotPt) {
                                    //let scaledPt = (xCenterOffset - eventPt.x) * xScaleFactor;
                                    // netOffset hack when explain why 136 can't be at the net
                                    if (newPlotPt.name == "TRK_HIT_NET") {
  //                                      newPlotPt.x = 0;
                                    }
                                    if (inRange(newPlotPt.x, plotPoints[ptIndex].x, plotPoints[ptIndex - 1].x)) {
                                        newPlotPt.index = ptIndex;
                                        newPlot.y = ( plotPoints[ ptIndex].y + plotPoinss[ ptIndex - 1]) / 2.0
                                        newPlotPt.trajIndex - plotPoints[ptIndex].trajIndex;
                                        plotPoints.splice(ptIndex, 0, newPlotPt);
                                        ptInserted = true;
                                        playEndIndex = plotPoints.length;
                                        break;
                                    }
                                } else if (eventPt.pt.tick == plotPoints[ptIndex].tick) {
                                    plotPoints[ptIndex].name = eventPt.name;
                                    ptInserted = true;
                                    break;
                                }
                            }
                        } catch (error) {
                            console.error(error);
                            const errorMess = '{"message": "' + error.message + '"}';
                            ctx.body = errorMess;
                            return;
                        }
                        if (ptInserted === false) {
                            newPlotPt.index = playEndIndex + 1;
                            plotPoints.splice(playEndIndex + 1, 0, newPlotPt);
                        }
                    })
                }
            })
            finalPlotPt.finalPlotPoint = true;
            firstPlotPt.dataLabel.ptCount = ptCount;

        })
        let playIndex
        for( let ptIndex = 0; ptIndex < plotPoints.length; ++ptIndex) {
            if( plotPoints[ ptIndex].trajIndex == 0){
                playIndex = 0;
            }
            plotPoints[ ptIndex].trajIndex = playIndex;
            plotPoints[ ptIndex].index = ptIndex;
            ++playIndex;
        }

        let plotData = {
            datalength: plotPoints.length,
            data: plotPoints,
            videos: videoData
        }
        console.log( "Lowest Plot Y Value: " + lowestY + " at ", [lowYPoints, lowYPlotPoints]);
        console.log( "Table Endpoints:", tableEndPts)
        console.log( "Table Edges:", tableEdges)
        if( useLocalStorage) {
            let fname = '/Users/stangregg/Documents/Sports3-D_LLC/development/json_dumps/parsed_plot_data.2022-07-10-' + frameId + '.json';
            let writeData = JSON.stringify(plotData);
            fs.writeFileSync(fname, writeData);
        }
        ctx.body = plotData;

    } catch (error) {
        console.error(error);
        const errorMess = '{"message": "' + error.message + '"}';
        ctx.body = errorMess;
    }

})


let koaOptions = {
    origin: '*',
    allowMethods: '*',
    allowHeaders: '*'
};

    app
        .use( cors( koaOptions))
        .use(router.routes())
        .use(router.allowedMethods());


//const PORT = process.env.PORT || 3000;
///app.listen(PORT, () => console.log(`running on port ${PORT}`));
const PORT = process.env.PORT || 8888;

// if you're not using docker-compose for local development, this will default to 8888
// to prevent non-root permission problems with 80. Dockerfile could be set to make this 80
// because containers don't have that issue :)

// x-response-time

app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    ctx.set('X-Response-Time', `${ms}ms`);
});

// logger

app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${ctx.method} ${ctx.url} - ${ms}`);
});

app.listen(PORT)

//
// need this in docker container to properly exit since node doesn't handle SIGINT/SIGTERM
// this also won't work on using npm start since:
// https://github.com/npm/npm/issues/4603
// https://github.com/npm/npm/pull/10868
// https://github.com/RisingStack/kubernetes-graceful-shutdown-example/blob/master/src/index.js
// if you want to use npm then start with `docker run --init` to help, but I still don't think it's
// a graceful shutdown of node process
//

// quit on ctrl-c when running docker in terminal
process.on('SIGINT', function onSigint () {
    console.info('Got SIGINT (aka ctrl-c in docker). Graceful shutdown ', new Date().toISOString());
    shutdown();
});

// quit properly on docker stop
process.on('SIGTERM', function onSigterm () {
    console.info('Got SIGTERM (docker container stop). Graceful shutdown ', new Date().toISOString());
    shutdown();
})

// shut down server
function shutdown() {
    server.close(function onServerClosed (err) {
        if (err) {
            console.error(err);
            process.exitCode = 1;
        }
        process.exit();
    })
}
//
// need above in docker container to properly exit
//

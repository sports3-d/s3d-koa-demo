

const { Pool } = require('pg');

function dbPool() {
    let pool = vmPool();
    return pool
}


function serverPool() {
    let pool = new Pool({
        host: 's3d-p3d-testdb.matrixdb.net',

        port: 5432,

        user: 'p3d_shotdb',
        database: 'p3d_shotdb_qa',
        password: 'drivesdataDFW' // Password is empty be default

    })
    return pool
}


function tunnelPool() {
    let pool = new Pool({
        username: 'tjl',
        host: '172.27.122.32',
        agent: process.env.SSH_AUTH_SOCK,
        privateKey: require('fs').readFileSync('/Users/stangregg/.ssh/id_perform'),
        port: 22,

        user: 'p3d_shotdb',
        database: 'p3d_shotdb_qa',
        password: 'drivesdataDFW', // Password is empty be default
        dstPort: 5432, // Default port
    })
    return pool
}

function vmPool() {
    let pool = new Pool({
        user: 'stangregg',
        host: '172.27.116.168',
        database: 'stangregg',
        password: 'testpassword', // Password is empty be default
        port: 5432, // Default por
    })
    return pool;
}

function localPool() {
    let pool = new Pool({
        user: 'stangregg',
        host: 'localhost',
        database: 'stangregg',
        password: 'testpassword', // Password is empty be default
        port: 5432, // Default port
    })
    return pool
}

module.exports = {  dbPool };

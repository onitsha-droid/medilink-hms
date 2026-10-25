#!/bin/bash
# Initialise the replica set on first run.
# This script is placed in /docker-entrypoint-initdb.d/ and executed by the
# official mongo image when the data directory is empty (i.e. on first start).
mongosh --quiet --eval "
  try {
    rs.status();
    print('Replica set already initialised');
  } catch (e) {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
    print('Replica set initialised');
  }
"

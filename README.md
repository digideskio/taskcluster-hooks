TaskCluster Hooks
=================
<img hspace="20" align="left" src="https://tools.taskcluster.net/lib/assets/taskcluster-120.png" />
[![Build Status](https://travis-ci.org/taskcluster/taskcluster-hooks.svg?branch=master)](http://travis-ci.org/taskcluster/taskcluster-hooks)
<!-- TODO: see https://www.npmjs.com/package/coveralls to set this up
[![Coverage Status](https://coveralls.io/repos/taskcluster/taskcluster-hooks/badge.svg?branch=master&service=github)](https://coveralls.io/github/taskcluster/taskcluster-hooks?branch=master)
-->
[![License](https://img.shields.io/badge/license-MPL%202.0-orange.svg)](http://mozilla.org/MPL/2.0)

A hooks service for triggering tasks from events.

API Documentation
-----------------
Please see http://docs.taskcluster.net/services/hooks/.

Testing
-------
TaskCluster components use "real" APIs for much of their testing, and thus
require credentials that cannot be checked into the repository.  To run all of
the tests, you will need to set up a `user-config.yml` with credentials to
connect to an influx database, and a TaskCluster Queue and Auth endpoint. This
file should be placed in the root directory of your checkout. We recommend
copying the file `user-config-example.yml` as `user-config.yml` and then
editing the values.

Speak to the Taskcluster team on IRC via `irc.mozilla.org#taskcluster` channel
to obtain credentials if you need them.

Tests can then be executed with `npm test`.

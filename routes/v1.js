var base        = require('taskcluster-base');
var debug       = require('debug')('hooks:routes:v1');
var Promise     = require('promise');
var taskcluster = require('taskcluster-client');
var nextDate    = require('../hooks/nextdate');
var _           = require('lodash');

var api = new base.API({
  title:         "Hooks API Documentation",
  description:   [
    "Hooks are a mechanism for creating tasks in response to events.",
    "",
    "Hooks are identified with a `hookGroupId` and a `hookId`.",
    "",
    "When an event occurs, the resulting task is automatically created.  The",
    "task is created using the scope `assume:hook-id:<hookGroupId>/<hookId>`,",
    "which must have scopes to make the createTask call, including satisfying all",
    "scopes in `task.scopes`.",
    "",
    "Hooks can have a 'schedule' indicating specific times that new tasks should",
    "be created.  Each schedule is in a simple cron format, per ",
    "https://www.npmjs.com/package/cron-parser.  For example:",
    " * `[\"0 0 1 * * *\"]` -- daily at 1:00 UTC",
    " * `[\"0 0 9,21 * * 1-5\", \"0 0 12 * * 0,6\"]` -- weekdays at 9:00 and 21:00 UTC, weekends at noon",
  ].join('\n'),
  schemaPrefix:  'http://schemas.taskcluster.net/hooks/v1/'
});

// Export api
module.exports = api;

/** Get hook groups **/
api.declare({
  method:       'get',
  route:        '/hooks',
  name:         'listHookGroups',
  idempotent:   true,
  output:       'list-hook-groups-response.json',
  title:        'List hook groups',
  description: [
    "This endpoint will return a list of all hook groups with at least one hook.",
  ].join('\n')
}, async function(req, res) {
  var groups = new Set();
  await this.Hook.scan({},{
    handler: (item) => {
      groups.add(item.hookGroupId);
    }
  });
  return res.reply({groups: Array.from(groups)});
});


/** Get hooks in a given group **/
api.declare({
  method:       'get',
  route:        '/hooks/:hookGroupId',
  name:         'listHooks',
  idempotent:   true,
  output:       'list-hooks-response.json',
  title:        'List hooks in a given group',
  description: [
    "This endpoint will return a list of all the hook definitions within a",
    "given hook group."
  ].join('\n')
}, async function(req, res) {
  var hooks = [];
  await this.Hook.query({
    hookGroupId: req.params.hookGroupId
  }, {
    handler: async (hook) => {
      hooks.push(await hook.definition());
    }
  });
  if (hooks.length == 0) {
    return res.status(404).json({
      message: "No such group"
    });
  }
  return res.reply({hooks: hooks});
});


/** Get hook definition **/
api.declare({
  method:       'get',
  route:        '/hooks/:hookGroupId/:hookId',
  name:         'hook',
  idempotent:   true,
  output:       'hook-definition.json',
  title:        'Get hook definition',
  description: [
    "This endpoint will return the hook defintion for the given `hookGroupId`",
    "and hookId."
  ].join('\n')
}, async function(req, res) {
  let hook = await this.Hook.load({
    hookGroupId: req.params.hookGroupId,
    hookId:      req.params.hookId
  }, true);

  // Handle the case where the hook doesn't exist
  if (!hook) {
    return res.status(404).json({
      message: "Hook not found"
    });
  }

  // Reply with the hook definition
  let definition = await hook.definition();
  return res.reply(definition);
});

/** Get hook's current status */
api.declare({
  method:       'get',
  route:        '/hooks/:hookGroupId/:hookId/status',
  name:         'getHookStatus',
  output:       'hook-status.json',
  title:        'Get hook status',
  description: [
    "This endpoint will return the current status of the hook.  This represents a",
    "snapshot in time and may vary from one call to the next."
  ].join('\n')
}, async function(req, res) {
  let hook = await this.Hook.load({
    hookGroupId: req.params.hookGroupId,
    hookId:      req.params.hookId
  }, true);

  // Handle the case where the hook doesn't exist
  if (!hook) {
    return res.status(404).json({
      message: "Hook not found"
    });
  }

  let reply = {lastFire: hook.lastFire}

  // Return a schedule only if a schedule is defined
  if (hook.schedule.length > 0) {
    reply.nextScheduledDate = hook.nextScheduledDate.toJSON();
    // Remark: nextTaskId cannot be exposed here, it's a secret.
    // If someone could predict the taskId they could use it, breaking this
    // service at best, at worst maybe exploit it to elevate from defineTask
    // to createTask without scope to schedule a task.
  }
  return res.reply(reply);
});


/** Get next scheduled hook date */
api.declare({
  method:       'get',
  route:        '/hooks/:hookGroupId/:hookId/schedule',
  name:         'getHookSchedule',
  output:       'hook-schedule.json',
  title:        'Get hook schedule',
  stability:    'deprecated',
  description: [
    "This endpoint will return the schedule and next scheduled creation time",
    "for the given hook."
  ].join('\n')
}, async function(req, res) {
  let hook = await this.Hook.load({
    hookGroupId: req.params.hookGroupId,
    hookId:      req.params.hookId
  }, true);

  // Handle the case where the hook doesn't exist
  if (!hook) {
    return res.status(404).json({
      message: "Hook not found"
    });
  }

  // Return a schedule only if a schedule is defined
  if (hook.schedule.length > 0) {
    return res.reply({
      schedule: hook.schedule,
      nextScheduledDate: hook.nextScheduledDate.toJSON(),
      // Remark: nextTaskId cannot be exposed here, it's a secret.
      // If someone could predict the taskId they could use it, breaking this
      // service at best, at worst maybe exploit it to elevate from defineTask
      // to createTask without scope to schedule a task.
    });
  }
  return res.reply({
    schedule: hook.schedule,
  });
});

/** Create a hook **/
api.declare({
  method:       'put',
  route:        '/hooks/:hookGroupId/:hookId',
  name:         'createHook',
  deferAuth:    true,
  idempotent:   true,
  scopes:       [[
                    "hooks:modify-hook:<hookGroupId>/<hookId>",
                    "assume:hook-id:<hookGroupId>/<hookId>",
                ]],
  input:        'create-hook-request.json',
  output:       'hook-definition.json',
  title:        'Create a hook',
  description: [
    "This endpoint will create a new hook.",
    "",
    "The caller's credentials must include the role that will be used to",
    "create the task.  That role must satisfy task.scopes as well as the",
    "necessary scopes to add the task to the queue.",
  ].join('\n')
}, async function(req, res) {
  var hookGroupId = req.params.hookGroupId;
  var hookId    = req.params.hookId;
  var hookDef   = req.body;

  hookDef = _.defaults({hookGroupId, hookId}, hookDef);

  if (!req.satisfies({hookGroupId, hookId})) {
    return;
  }

  // Try to create a Hook entity
  try {
    var hook = await this.Hook.create(
      _.defaults({}, hookDef, {
        bindings:           [], // TODO
        triggerToken:       taskcluster.slugid(),
        lastFire:           {result: 'no-fire'},
        nextTaskId:         taskcluster.slugid(),
        nextScheduledDate:  nextDate(hookDef.schedule)
      }));
  } catch (err) {
    if (!err || err.code !== 'EntityAlreadyExists') {
      throw err;
    }
    let existingHook = await this.Hook.load({hookGroupId, hookId}, true);

    if (!_.isEqual(hookDef, await existingHook.definition())) {
      return res.status(409).json({
        message: "hook `" + hookGroupId + "/" + hookId + "` already exists."
      });
    }
  }

  // Reply with the hook definition
  return res.reply(hookDef);
});


/** Update hook definition**/
api.declare({
  method:       'post',
  route:        '/hooks/:hookGroupId/:hookId',
  name:         'updateHook',
  deferAuth:    true,
  idempotent:   true,
  scopes:       [[
                    "hooks:modify-hook:<hookGroupId>/<hookId>",
                    "assume:hook-id:<hookGroupId>/<hookId>",
                ]],
  input:        'create-hook-request.json',
  output:       'hook-definition.json',
  title:        'Update a hook',
  description: [
    "This endpoint will update an existing hook.  All fields except",
    "`hookGroupId` and `hookId` can be modified.",
  ].join('\n')
}, async function(req, res) {
  var hookGroupId = req.params.hookGroupId;
  var hookId = req.params.hookId;
  var hookDef = req.body;

  if (!req.satisfies({hookGroupId, hookId})) {
    return;
  }

  var hook = await this.Hook.load({hookGroupId, hookId}, true);

  if (!hook) {
    return res.status(404).json({
      message: "Hook not found. " +
        "Use PUT instead of PATCH to create a resource."
    });
  }

  // Attempt to modify properties of the hook
  var schedule = hookDef.schedule ? hookDef.schedule : [];
  await hook.modify((hook) => {
    hook.metadata          = hookDef.metadata;
    hook.task              = hookDef.task;
    hook.deadline          = hookDef.deadline;
    hook.expires           = hookDef.expires ? hookDef.expires : '';
    hook.schedule          = schedule;
    hook.nextTaskId        = taskcluster.slugid();
    hook.nextScheduledDate = nextDate(schedule);
  });

  let definition = await hook.definition();
  return res.reply(definition);
});

/** Delete hook definition**/
api.declare({
  method:       'delete',
  route:        '/hooks/:hookGroupId/:hookId',
  name:         'removeHook',
  idempotent:   true,
  deferAuth:    true,
  scopes:       [["hooks:modify-hook:<hookGroupId>/<hookId>"]],
  title:        'Delete a hook',
  description: [
    "This endpoint will remove a hook definition."
  ].join('\n')
}, async function(req, res) {
  var hookGroupId = req.params.hookGroupId;
  var hookId = req.params.hookId;

  if (!req.satisfies({hookGroupId, hookId})) {
    return;
  }

  // Remove the resource if it exists
  await this.Hook.remove({hookGroupId, hookId}, true);

  return res.status(200).json({});
});

// XXX disabled for the first draft of this service
if (0) {

/** Get secret token for a trigger **/
api.declare({
  method:       'get',
  route:        '/hooks/:hookGroupId/:hookId/token',
  name:         'getTriggerToken',
  deferAuth:    true,
  scopes:       [["hooks:get-trigger-token:<hookGroupId>/<hookId>"]],
  input:        undefined,
  output:       'trigger-token-response.json',
  title:        'Get a trigger token',
  description: [
    "Retrieve a unique secret token for triggering the specified hook. This",
    "token can be deactivated with `resetTriggerToken`."
  ].join('\n')
}, async function(req, res) {
  var hookGroupId = req.params.hookGroupId;
  var hookId    = req.params.hookId;
  if (!req.satisfies({hookGroupId, hookId})) {
    return;
  }

  let hook = await this.Hook.load({hookGroupId, hookId}, true);

  if (!hook) {
    return res.status(404).json({
      message: "Hook not found"
    });
  }

  return res.reply({
    token: hook.triggerToken
  });
});


/** Reset a trigger token **/
api.declare({
  method:       'post',
  route:        '/hooks/:hookGroupId/:hookId/token',
  name:         'resetTriggerToken',
  deferAuth:    true,
  scopes:       [["hooks:reset-trigger-token:<hookGroupId>/<hookId>"]],
  input:        undefined,
  output:       'trigger-token-response.json',
  title:        'Reset a trigger token',
  description: [
    "Reset the token for triggering a given hook. This invalidates token that",
    "may have been issued via getTriggerToken with a new token."
  ].join('\n')
}, async function(req, res) {
  var hookGroupId = req.params.hookGroupId;
  var hookId    = req.params.hookId;
  if (!req.satisfies({hookGroupId, hookId})) {
    return;
  }

  let hook = await this.Hook.load({hookGroupId, hookId}, true);

  if (!hook) {
    return res.status(404).json({
      message: "Hook not found"
    });
  }

  await hook.modify((hook) => {
    hook.triggerToken = taskcluster.slugid();
  });

  return res.reply({
    token: hook.triggerToken
  });
});

/** Trigger hook from a webhook with a token **/
api.declare({
  method:       'post',
  route:        '/hooks/:hookGroupId/:hookId/trigger/:token',
  name:         'triggerHookWithToken',
  input:        'trigger-payload.json',
  output:       'task-status.json',
  title:        'Trigger a hook with a token',
  description: [
    "This endpoint triggers a defined hook with a valid token."
  ].join('\n')
}, async function(req, res) {
  var payload = req.body;

  var hook = await this.Hook.load({
    hookGroupId: req.params.hookGroupId,
    hookId:      req.params.hookId
  }, true);

  // Return a 404 if the hook entity doesn't exist
  if (!hook) {
    return res.status(404).json({
      message: "Hook not found"
    });
  }

  // Return 401 if the token doesn't exist or doesn't match
  if (req.params.token !== hook.triggerToken) {
    return res.status(401).json({
      message: "Invalid token"
    });
  }

  let resp = await this.taskcreator.fire(hook, payload);
  return res.reply(resp);
});


/** Trigger a hook for debugging **/
api.declare({
  method:       'post',
  route:        '/hooks/:hookGroupId/:hookId/trigger',
  name:         'triggerHook',
  deferAuth:    true,
  scopes:       [["hooks:trigger-hook:<hookGroupId>/<hookId>"]],
  input:        'trigger-payload.json',
  output:       'task-status.json',
  title:        'Trigger a hook',
  description: [
    "Trigger a hook, given that you have the correct scoping for it"
  ].join('\n')
}, async function(req, res) {
  var hookGroupId = req.params.hookGroupId;
  var hookId    = req.params.hookId;
  if (!req.satisfies({hookGroupId, hookId})) {
    return;
  }

  var payload = req.body;

  var hook = await this.Hook.load({hookGroupId, hookId}, true);

  // Return a 404 if the hook entity doesn't exist
  if (!hook) {
    return res.status(404).json({
      message: "Hook not found"
    });
  }

  let resp = await this.taskcreator.fire(hook, payload);
  return res.reply(resp);
});
}

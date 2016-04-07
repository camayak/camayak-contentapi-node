"use strict"
const CamayakContentAPI = require('./lib/camayak_contentapi');

const api_key 		= process.env.CAMAYAK_API_KEY 		|| "my api key from the Camayak publishing destination";
const shared_secret = process.env.CAMAYAK_SHARED_SECRET || "my shared secret from the Camayak publishing destination";

// Create an instance of the Camayak Content API SDK.
// The SDK constists of an HTTP server pre-configured with
// routes for handling Camayak Content API webhook events.

// The SDK receives these events, then invokes one of 3
// handler functions that you pass into the SDK:

// publish - for the initial publish of an approved assignment
// update - for any subsequent publish of the assignment
// retract - for when the assignment is retracted in Camayak

// The handler functions for each of these events is passed a
// "webhook" object, and the content of the assignment.

// In your integration, you take the content of the assignment,
// do whatever you want with it (push it to Facebook, Slack, Tumblr,
// your own CMS, etc.) then invoke a .succeed or a .fail function on
// webhook object to inform Camayak of the success or failure of the
// publishing.

// In the event of failure, Camayak will retry the webhook.

let camayak = new CamayakContentAPI({
	api_key: api_key,
	shared_secret: shared_secret,
	publish: function(webhook, content) {
		// Create new Post wherever
		// 
		let handler = new MyCustomIntegration();
		handler.publish(content, function(error, response){
			if (error) {
				return webhook.fail(error);
			};
			return webhook.succeed({
				published_id: response.published_id,
				published_url: response.published_url
			});
		});
	},
	update: function(webhook, content) {
		// Update new Post wherever using content.published_id
		// 
		let handler = new MyCustomIntegration();
		handler.update(content, function(error, response){
			if (error) {
				return webhook.fail(error);
			};
			return webhook.succeed({
				published_id: response.published_id,
				published_url: response.published_url
			});
		});
	},
	retract: function(webhook, content) {
		// Retract Post using content.published_id
		//
		let handler = new MyCustomIntegration();
		handler.retract(content, function(error, response){
			if (error) {
				return webhook.fail(error);
			};
			return webhook.succeed({
				published_id: response.published_id,
				published_url: response.published_url
			});
		})
	},
	error: function(error, webhook) {
		// Handle unexpected errors in the Camayak service
		webhook.fail(error);
	}
});

// Start listening for webhooks
camayak.start();
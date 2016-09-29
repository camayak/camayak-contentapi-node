"use strict"

const express     = require('express');
const bodyParser  = require('body-parser');
const qs          = require('querystring');
const crypto      = require('crypto');
const request     = require('request');

const CONTENT_API_ENDPOINT = "https://content.camayak.com/v1/content/";

class CamayakContentAPI {
    constructor(options) {
        // Configure options
        this.api_key            = options.api_key;
        this.shared_secret      = options.shared_secret;
        this.port               = options.port    || 5000;
        this.onPublish          = options.publish || this.noOp;
        this.onUpdate           = options.update  || this.noOp;
        this.onRetract          = options.retract || this.noOp;
        this.onError            = options.error   || this.handle_error;
        // Create an express server.
        this.app = express();
        // All Camayak webhook bodies are JSON
        this.app.use(bodyParser.json());
        // Mount the routes.
        this.app.get('/'          , this.ping);
        this.app.get('/webhook/'  , this.ping);
        this.app.post('/webhook/' , this.receive_webhook.bind(this));
    }

    // Generates an HMAC signature to sign Content API request
    generate_sig(api_key, secret) {
        let date = Math.floor(Date.now() / 1000).toString();
        let hmac = crypto.createHmac("sha1", secret);
        hmac.update(date+api_key);
        return hmac.digest("hex");
    }

    // Start listening for webhook requests
    start() {
        var listener = this.app.listen(this.port, function() {
            console.log("Camayak content API webhook receiver started on port " + listener.address().port);
        });
    }

    list(options, cb) {
        // Create a params object containing the api_key
        let params = {
            api_key: this.api_key
        };
        //  If we have specified a shared secret when creating the Content API
        //  publishing destination, then we add the signature to the url
        if (this.shared_secret) {
            params.api_sig = this.generate_sig(this.api_key, this.shared_secret);
        };
        // Add the query string paramaters to the url
        let url = CONTENT_API_ENDPOINT + "?" + qs.stringify(params);
        console.log(url);
        request.get(url, (err, response, body) => {
            // If the content API returns an error, respond to the webhook with an error.
            if (err) {
                return cb(err, response);
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
                return cb({statusCode: response.statusCode, error: body}, null);
            }
            return cb(null, body);
        });
    }

    get(uuid, cb) {
        // Create a params object containing the api_key
        let params = {
            api_key: this.api_key
        };
        //  If we have specified a shared secret when creating the Content API
        //  publishing destination, then we add the signature to the url
        if (this.shared_secret) {
            params.api_sig = this.generate_sig(this.api_key, this.shared_secret);
        };
        // Add the query string paramaters to the url
        let url = CONTENT_API_ENDPOINT + uuid + "/?" + qs.stringify(params);
        request.get(url, (err, response, body) => {
            // If the content API returns an error, respond to the webhook with an error.
            if (err) {
                return cb(err, response);
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
                return cb({statusCode: response.statusCode, error: body}, null);
            }
            return cb(null, body);
        });
    }

    // Camayak will do a "GET" to the webhook url to verify it's available.
    //  just return a 200 response
    ping(req, res) {
        return res.status(200).send("Ok.");
    }

    // The Webhook handler for the Camayak Content API.
    //
    //  There are 3 possible events types:
    //    validate - Another test type.
    //    publish  - Initial publishing, or update, of a Camayak assignment
    //               If the assignment contains a published_id (returned by a previous
    //               webhook response) the assignment is being updated.
    //               otherwise, the assignment is being intially published
    //    retract  - The assignment has been retracted in Camayak and should be made
    //               unavailable in the external system
    //
    receive_webhook(req, res) {
        let event   = req.body.event,         // The Camayak Publishing API Event type
            id      = req.body.event_id,      // The Camayak Publishing API Event ID
            url     = req.body.resource_uri,  // The URL to the Assignment in the Content API
            webhook = new WebHook(res);       // Create a Webhook object to handle responses  
        if (event === "validate") {
            //  Camayak will send a validate request to ensure that the webhook url
            //  entered conforms to the spec and returns an expected string "pong".
            res.set('Content-Type', 'text/plain').status(200).send('pong');
        } else if (event === "publish" || event === "retract") {
            //  If we have received a publish or a retract event, we need to fetch
            //  the assignment from the Camayak Content API using the url specified
            //  in the webhook response.
            //
            //  We need to add our API key to the url specified in the webhook response
            let params = {
                api_key: this.api_key
            };
            //  If we have specified a shared secret when creating the Content API
            //  publishing destination, then we add the signature to the url
            if (this.shared_secret) {
                params.api_sig = this.generate_sig(this.api_key, this.shared_secret);
            };
            // Add the query string paramaters to the url
            url += "?" + qs.stringify(params);
            let errorHandler = this.onError;
            // Make an HTTP GET to the content API to fetch the assignment information
            request.get(url, (err, response, body) => {
                // If the content API returns an error, respond to the webhook with an error.
                if (err) {
                    return errorHandler(err, webhook);
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    return errorHandler(response.statusCode, webhook);
                }
                // Parse the Content API response into Javascript
                let content;
                try {
                    content = JSON.parse(body);
                } catch (e) {
                    return errorHandler("Unable to parse content api response", webhook);
                }
                // Depending on which event type (and whether the assignment has already been published)
                //  do the right thing
                if (event === "publish" && content.published_id) {
                    // Call the UPDATE handler 
                    return this.onUpdate(webhook, content)
                } else if (event === "publish") {
                    // Call the PUBLISH handler
                    return this.onPublish(webhook, content)
                } else if (event === "retract" && content.published_id) {
                    // call the RETRACT handler
                    return this.onRetract(webhook, content)
                } else {
                    // Error handler for unexpected situation, like a
                    //  retract event, but no published_id
                    return this.onError("Unexpected Error", webhook);
                }
            });
        } else {
            // No event type, malformed body, or unknown event type was sent.
            return this.onError("Unknown event type", webhook);
        }
    }
    // A default no-op handler for for the varied events
    //  returns a success event to the webhook.
    //  This would not be used in a real app, but give an example
    //  of usage for the publish, update, and retract events.
    noOp(webhook, content) {
        return webhook.succeed();
    }
    // A default error handler for the varied events.
    //  returns an error to the webhook, which will be tried again.
    handle_error(error, webhook) {
        return webhook.fail(error)
    }
}

// A wrapper around the Express response object
//  for the inbound webhook.  Has a couple
//  of convenience features for returning a success
//  or error to Camayak
class WebHook {
    constructor(res) {
        this.res = res;
    }
    // Respond to the Camayak webhook with a success.
    //  pass an optional object containing the id and 
    //  url of assignment in whatever external system
    //  it was stored in, so it can be updated or
    //  retracted in the future.
    //  webhook_response: 
    //  {
    //      published_id: "abc123",
    //      published_url: "http://example.com/posts/abc123"
    //  }
    succeed(webhook_response) {
        this.res.status(200).send(webhook_response);
    }
    // Respond to the Camayak webhook with an error.
    //  The webhook will be retried a number of times
    //  with an increasing delay between attempts.
    fail(error) {
        this.res.status(500).send(error);
    }
}

module.exports = CamayakContentAPI

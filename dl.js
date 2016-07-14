var request = require('request');
var cheerio = require('cheerio');
var _ = require('lodash');
var Q = require('q');
var querystring = require('querystring');
var fs = require('fs');
var https = require('https');
var Entities = require('html-entities').AllHtmlEntities;
var exec = require('child_process').exec;
var Jetty = require("jetty");


var entities = new Entities();
var jetty = new Jetty(process.stdout);

// -----------------------------------

var d = function(vari) { console.log(require('util').inspect(vari, {colors: true, depth: 7})); };
var dd = function(vari) { console.log(require('util').inspect(vari, {colors: true, depth: 7})); process.exit(); };

// -----------------------------------

var baseuri = "https://www.youtube.com";

var username = "quill18creates";
var dest = __dirname + "/down";
var parallelvideos = 4;

var debug = false; // only get first element when debug

/*
getAllVideosInAllPlaylistsOfUser(username).then(function(list) {
    fs.writeFile("test.json", JSON.stringify(list));
});
*/

console.log("\n");
console.log("crawling youtube. getting all videos....");
getAllVideosInAllPlaylistsOfUser(username).then(function(list) {

    //var list = JSON.parse(fs.readFileSync("test.json"));

    fs.stat(dest, function(err, stats) {

        // DownloadOrdner erstellen
        if(err) {
            fs.mkdirSync(dest);
        }

        var downloadlist = [];

        _.each(list, function(playlist) {

            var playlistfolder = dest + "/" + formatfilename(playlist.title);

            _.each(playlist.videos, function(video) {

                downloadlist.push(
                    {
                        id: video.id,
                        dest: playlistfolder + "/" + formatfilename(video.title) + ".mp4",
                        playlistfolder: playlistfolder,
                        title: video.title
                    }
                );

            });

        });

        startDownloads(downloadlist);

    });

});


var slots = [];

function startDownloads(downloadlist) {

    var slotids = 0;
    setInterval(function() {

        if (downloadlist.length > 0 && slots.length < parallelvideos) {

            downloadNext(downloadlist, slotids);
            slotids++;

        }

        jetty.clear();
        jetty.moveTo([0,0]);

        jetty.text(downloadlist.length + " videos remaining... \n\n");


        _.each(slots, function(slot) {

            jetty.text(slot.title + "\n    => " + slot.status + " - audio: " + slot.audioprogress + "%  video: " + slot.videoprogress + "% \n\n");

        });

        if(downloadlist.length == 0 && slots.length == 0) {
            jetty.text(" ------------- all done ------------- ");
            process.exit();
        }

    }, 1000);

}


function downloadNext(downloadlist, slotid) {

    var thisdownload = downloadlist.shift();

    fs.stat(thisdownload.playlistfolder, function(err, stats) {

        if (err) {
            fs.mkdirSync(thisdownload.playlistfolder);
        }

        slots.push({
            id: slotid,
            status: "starting",
            audioprogress: 0,
            videoprogress: 0,
            title: thisdownload.title
        });

        getVideoAndAudioAndDownloadAndEncode(thisdownload.id, thisdownload.dest, function(s) {


            //status
            var index = _.findIndex(slots, function(item) {
               return item.id == slotid;
            });

            if(index >= 0) {

                if (s.status) {
                    slots[index].status = s.status;
                }
                if (s.audioprogress) {
                    slots[index].audioprogress = s.audioprogress;
                }
                if (s.videoprogress) {
                    slots[index].videoprogress = s.videoprogress;
                }

            }

        }).then(function () {

            //done
            slots = _.reject(slots, function(item) { return item.id == slotid; });

        });

    });

}




// ----------------------------------------



function formatfilename(str) {
    return entities.decode(str).replace(/[^a-z0-9\-]/gi, '_').toLowerCase().replace(/_+/g, "_");
}

function getVideoAndAudioAndDownloadAndEncode(id, dest, scb) {
    var deferred = Q.defer();

    fs.stat(dest, function(err, stats) {

        if(err) {
            // Datei existiert noch nicht

            getBestVideoUrl(id).then(function (data) {

                scb( { status: "downloading" } );

                Q.all([
                    (function () {
                        var deferred = Q.defer();

                        download(data.video, dest + "_video", scb, "videoprogress").then(function () {
                            deferred.resolve();
                        }, function (error) {
                            deferred.reject(error);
                        });

                        return deferred.promise;
                    })(),
                    (function () {
                        var deferred = Q.defer();

                        download(data.audio, dest + "_audio", scb, "audioprogress").then(function () {
                            deferred.resolve();
                        }, function (error) {
                            deferred.reject(error);
                        });

                        return deferred.promise;
                    })()

                ]).then(function () {

                    //console.log(" -> downloads done. encoding");
                    scb( { status: "encoding" } );

                    //encode
                    var cmd = 'ffmpeg -i ' + dest + "_video -i " + dest + "_audio " + dest;

                    exec(cmd, {maxBuffer: 1024 * 1024 * 3}, function (err, stdout, stderr) { //Maxbuffer auf 3 MB

                        if (!err) {
                            //console.log(" -> encoding done");
                            deferred.resolve();
                        } else {
                            console.log(" -> encoding failed");
                            deferred.reject(err);
                        }

                        fs.unlink(dest+"_video");
                        fs.unlink(dest+"_audio");

                    });


                });

            });
        } else {
            //console.log(" -> finished video there... skipping..")
            deferred.resolve();
        }
    });

    return deferred.promise;
}

function download(url, dest, scb, statuskey) {
    var deferred = Q.defer();

    fs.stat(dest, function(err, stats) {

        if(err) {
            // Datei existiert noch nicht

            var file = fs.createWriteStream(dest);

            https.get(url, function(response) {

                var len = parseInt(response.headers['content-length'], 10);
                var cur = 0;


                response.pipe(file);

                file.on('finish', function() {

                    file.close(function() {
                        deferred.resolve();
                    });
                });

                response.on("data", function(chunk) {
                    cur += chunk.length;

                    var s = {};
                    s[statuskey] = Math.round(100.0 * cur / len);

                    scb(s);
                });


            }).on('error', function(err) {
                fs.unlink(dest);

                console.log("... error ...");

                deferred.reject(err.message);

            });


        } else {
            console.log("... skipping ...");
            deferred.resolve(); // Datei schon da
        }

    });

    return deferred.promise;
}


function getBestVideoUrl(id) {
    var deferred = Q.defer();

    request(baseuri + "/get_video_info?video_id=" + id, function (error, response, body) {

        if (!error && response.statusCode == 200) {

            var infos = querystring.parse(body);

            var rformats = infos["adaptive_fmts"].split(",");

            var formats = [];
            _.each(rformats, function(item) {
                formats.push(querystring.parse(item));
            });


            //best Resolution
            var maxqualityvideo = _.maxBy(formats, function(item) {
                if( (/video\/mp4/).test(item.type) ) {
                    return parseInt(item.quality_label);
                } else {
                    return 0;
                }
            });

            var maxqualityaudio = _.maxBy(formats, function(item) {
                if( (/audio\/mp4/).test(item.type) ) {
                    return parseInt(item.bitrate);
                } else {
                    return 0;
                }
            });

            deferred.resolve({ video: maxqualityvideo.url, audio: maxqualityaudio.url });

        } else {
            deferred.reject(error);
        }

    });

    return deferred.promise;
}


// ---------------------------------------- get Links and IDs

function getAllVideosInAllPlaylistsOfUser(username, callback) {
    var deferred = Q.defer();

    getPlaylistsOfUser(username).then(function (playlists) {

        var promises = [];
        _.each(playlists, function (playlist) {

            promises.push(getVideosInPlaylist(playlist.playlistid));

        });

        Q.all(promises).then(function (videos) {

            var fullplaylists = [];

            videos = _.flatten(videos);

            _.each(playlists, function (playlist) {

                var vv = [];

                _.each(_.filter(videos, function (item) {
                    return item.playlistid == playlist.playlistid;
                }), function(v) {

                    vv.push({
                        title: v.title,
                        id: v.videoid
                    })

                });


                fullplaylists.push({
                    title: playlist.title,
                    videos: vv
                });

            });

            deferred.resolve(fullplaylists);

        }, function(error) {
            deferred.reject(error);
        });

    }, function(error) {
        deferred.reject(error);
    });

    return deferred.promise;
}



function getPlaylistsOfUser(username) {
    var deferred = Q.defer();

    request(baseuri + "/c/" + username + "/playlists", function (error, response, body) {

        if (!error && response.statusCode == 200) {

            var $ = cheerio.load(body);

            var listtags = $(".yt-lockup-title a");

            var playlists = [];

            _.each(listtags, function(item, i) {

                if(!debug || i == 0) {

                    var listtag = $(item);

                    var playlistidmatch = listtag.attr("href").match(/playlist\?list=([^&]+)/);

                    if(playlistidmatch != null && playlistidmatch.length >= 2) {

                        var playlist = {
                            title: listtag.html().replace(/^[\s]*/, "").replace(/[\s]*$/g, ""),
                            playlistid: playlistidmatch[1]
                        };

                        playlists.push(playlist);

                    }

                }

            });

            deferred.resolve(playlists);

        } else {
            deferred.reject(error);
        }

    });

    return deferred.promise;
}

function getVideosInPlaylist(id) {
    var deferred = Q.defer();


    request(baseuri + "/playlist?list=" + id, function (error, response, body) {

        if (!error && response.statusCode == 200) {

            var $ = cheerio.load(body);

            var vtags = $(".pl-video-title a");

            var videos = [];

            _.each(vtags, function (item, i) {

                if(!debug || i == 0) {

                    var vtag = $(item);

                    var videoidmatch = vtag.attr("href").match(/watch\?v=([^&]+)/);

                    if(videoidmatch != null && videoidmatch.length >= 2) {

                        var v = {
                            playlistid: id,
                            videoid: videoidmatch[1],
                            title: vtag.html().replace(/^[\s]*/, "").replace(/[\s]*$/g, "")
                        };

                        videos.push(v);

                    }

                }

            });

            deferred.resolve(videos);


        } else {
            deferred.reject(error);
        }

    });

    return deferred.promise;
}



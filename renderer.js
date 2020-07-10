// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.
$(document).ready(function () {
  console.log("ready!");
  $("#reader-container").hide();
  // window.api.send("toMain", "window is ready");
  window.api.receive("fromMain", (data) => {
    console.log(`Received ${JSON.stringify(data)} from main process`);
    $("#" + data.elementid).html(data.value);
    // document.getElementById(data.elementid).innerText = data.value;
  });
  $("form").submit(function (evt) {
    evt.preventDefault();
    window.api.send("toMain", {
      type: 'connect',
      protocol: $("#input-protocol").val(),
      host: $("#input-host").val(),
      port: $("#input-port").val(),
      path: $("#input-path").val() || null
    });
    $("#login-container").hide();
    $("#reader-container").show();
  });
  $("#disconnect").click(function () {
    window.api.send("toMain", {
      type: 'disconnect'
    });
    $("#login-container").show();
    $("#reader-container").hide();
    location.reload();
  });
});
